import { BadRequestException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Events, GatewayIntentBits, type Message } from 'discord.js';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError, isDiscordError } from '../discord/discord-errors';
import { parseGuildChannel } from '../plugins/plugin-channel';
import { PluginKindRegistry, type PluginKindDef } from '../plugins/plugin-kinds';
import {
  findQuestion,
  matchRecipes,
  parsePhrases,
  relayedAuthor,
  type CrafterQuestion,
} from './crafter-question';
import {
  GuildRecipesService,
  type GuildProfessionsDto,
  type GuildRecipe,
} from './guild-recipes.service';

/** A Guild Chat Profession Listener's settings. */
export interface ProfessionListenerConfig {
  serverId: string;
  channelId: string;
  /** What makes a message a question: "who can craft", "LF crafter", … */
  phrases: string[];
  /** Answer whoever asked in a DM. */
  sendDm: boolean;
  /** Answer in the channel too, as a reply to the question. */
  postInChannel: boolean;
}

/** A message in a listened channel, as the listener needs it. */
export interface ChatMessage {
  serverId: string;
  channelId: string;
  messageId: string;
  /** Its text; an embed's description when it has no text (some relays of game chat post embeds). */
  text: string;
  authorId: string;
  /** The author's name on Discord (their display name, else username), or the webhook's name. */
  authorName: string;
  /** Posted by a bot or a webhook: a relay of the game's guild chat, most likely. */
  relayed: boolean;
  /** A webhook's name (relays name it after the character), or the embed's author. */
  relayName: string | null;
  /**
   * Others can reply to it. Not to a message an app posted as the person (the game's guild chat,
   * relayed under each player's linked Discord account): Discord refuses those replies ("This action
   * requires an application to be authorized by the user").
   */
  replyable: boolean;
}

/** Who asked: their Discord account when known, and how to name them in the log. */
interface Asker {
  discordUserId: string | null;
  label: string;
  key: string;
}

type ListenerStatus =
  | { state: 'idle' }
  | { state: 'listening' }
  | { state: 'refused' }
  | { state: 'failed'; error: string };

/** Where the worker leaves its connection's status for the backoffice (API and worker share it). */
const STATUS_KEY = 'professions:listener-status';
const STATUS_TTL_MS = 2 * 60 * 1000;
/** Plugins are reloaded this often, so changes apply without a restart. */
const RELOAD_MS = 30 * 1000;
/** Discord refused the Message Content intent: asking again soon is pointless. */
const RETRY_REFUSED_MS = 10 * 60 * 1000;
const RETRY_FAILED_MS = 60 * 1000;
/**
 * The same person asking about the same thing again within this long gets no second answer, by DM
 * or in the channel (each counted on its own, and only once it was delivered).
 */
const COOLDOWN_MS = 10 * 60 * 1000;
/** The guild's recipes are read again after this long (answers within a burst share one read). */
const RECIPES_MS = 30 * 1000;
/** At most this many recipes in an answer. */
const MAX_RECIPES = 3;
/** Discord's limit for a message, less room for the "more" line. */
const MAX_LENGTH = 1850;

export const REFUSED_NOTICE =
  'Discord doesn’t let the bot read messages yet: turn on Message Content Intent in the Discord ' +
  'Developer Portal (the application’s Bot tab, Privileged Gateway Intents). It tries again every 10 minutes.';

const escapeMarkdown = (text: string): string => text.replace(/([\\*_~`|[\]<>])/g, '\\$1');

const listOf = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** "Flask of the Titans", "A, B and C", "A, B and C and 2 more": the recipes an answer is about. */
const recipeList = (recipes: readonly { name: string }[]): string =>
  `${listOf(recipes.slice(0, MAX_RECIPES).map((r) => r.name))}${recipes.length > MAX_RECIPES ? ` and ${recipes.length - MAX_RECIPES} more` : ''}`;

/** A recipe of an answer and who can craft it. */
export interface AnswerRecipe {
  name: string;
  url: string;
  crafters: { character: string; discordUserId: string | null; discordName: string | null }[];
}

/**
 * The answer's lines, one per player and recipe:
 * "- [Svajone](<https://discord.com/users/…>) can craft [Flask of the Titans](<wowhead>) with
 * character Svajone Potato". A character with no Discord account says so. At most `MAX_RECIPES`
 * recipes; what doesn't fit ends in "…and 4 more".
 */
export function answerLines(recipes: readonly AnswerRecipe[]): string {
  const lines: string[] = [];
  let length = 0;
  let left = 0;
  for (const recipe of recipes.slice(0, MAX_RECIPES)) {
    const item = `[${escapeMarkdown(recipe.name)}](<${recipe.url}>)`;
    const players = new Map<string, { name: string | null; characters: string[] }>();
    const unlinked: string[] = [];
    for (const crafter of recipe.crafters) {
      if (!crafter.discordUserId) {
        unlinked.push(crafter.character);
        continue;
      }
      const player = players.get(crafter.discordUserId) ?? {
        name: crafter.discordName,
        characters: [],
      };
      player.characters.push(crafter.character);
      players.set(crafter.discordUserId, player);
    }
    const recipeLines = [
      ...[...players].map(([id, player]) => {
        const who = player.name ?? `${player.characters[0]}’s player`;
        const characters = player.characters.map(escapeMarkdown);
        return `- [${escapeMarkdown(who)}](<https://discord.com/users/${id}>) can craft ${item} with character${characters.length === 1 ? '' : 's'} ${listOf(characters)}`;
      }),
      ...unlinked.map(
        (character) =>
          `- ${escapeMarkdown(character)} can craft ${item} (no Discord account linked)`,
      ),
    ];
    for (const line of recipeLines) {
      if (length + line.length + 1 > MAX_LENGTH) {
        left++;
        continue;
      }
      lines.push(line);
      length += line.length + 1;
    }
  }
  const moreRecipes = Math.max(0, recipes.length - MAX_RECIPES);
  if (left > 0) lines.push(`…and ${left} more: \`/crafter\` lists them all.`);
  if (moreRecipes > 0) {
    lines.push(
      `…and ${moreRecipes} more recipe${moreRecipes === 1 ? '' : 's'} match: ask with the full name, or use \`/crafter\`.`,
    );
  }
  return lines.join('\n');
}

/**
 * Guild Chat Profession Listener, a plugin kind of professions: reads the messages of a channel
 * (the guild chat) as they arrive and, when one asks who can craft something the guild can make
 * ("who can craft flask of titans?", "LF crafter [Flask of the Titans]", a Wowhead link), answers
 * whoever asked in a DM and/or in the channel with who can craft it. The game's guild chat comes in
 * two ways: posted by an app as each player's linked Discord account (answered like anyone's, but
 * not as a reply, which Discord refuses), or relayed by a bot or a webhook (the asker is found by
 * character name).
 *
 * It has its own connection to Discord, opened only while a guild has one of these plugins, with the
 * privileged Message Content intent (message text). The honeypots' connection reads no text and is
 * left alone, so a portal without the intent can't break honeypots. Runs in the worker.
 */
@Injectable()
export class CrafterListenerService implements OnModuleInit {
  private readonly logger = new Logger(CrafterListenerService.name);
  private client: Client | null = null;
  private connecting = false;
  private timer: NodeJS.Timeout | null = null;
  private status: ListenerStatus = { state: 'idle' };
  private retryAt = 0;
  /** Enabled listeners by channel id. */
  private listeners = new Map<
    string,
    { id: string; guildId: string; name: string; config: ProfessionListenerConfig }[]
  >();
  /** When each asker last got each answer: "plugin|asker|recipes" → ms. */
  private readonly answered = new Map<string, number>();
  private readonly recipes = new Map<
    string,
    { at: number; data: Promise<GuildProfessionsDto & { owners: Map<string, string> }> }
  >();

  constructor(
    private readonly registry: PluginKindRegistry,
    private readonly guildRecipes: GuildRecipesService,
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.add(this.def);
  }

  readonly def: PluginKindDef<ProfessionListenerConfig> = {
    kind: 'PROFESSION_LISTENER',
    label: 'Guild Chat Profession Listener',
    description:
      'Listens to a channel (the guild chat) and, when someone asks who can craft something, tells them who in the guild can: by DM, in the channel, or both.',
    live: true,
    notice: async () => {
      const status = await this.cache.get<ListenerStatus>(STATUS_KEY);
      if (status?.state === 'refused') return REFUSED_NOTICE;
      if (status?.state === 'failed') {
        return `Not connected to Discord (${status.error}). It tries again every minute.`;
      }
      return null;
    },

    parseConfig: async (input, context) => {
      const config = (input ?? {}) as Record<string, unknown>;
      const { serverId, channelId } = await parseGuildChannel(config, context);
      const parsed = parsePhrases(config.phrases);
      if ('error' in parsed) throw new BadRequestException(parsed.error);
      const sendDm = config.sendDm !== false;
      const postInChannel = config.postInChannel === true;
      if (!sendDm && !postInChannel) {
        throw new BadRequestException('Pick how to answer: by DM, in the channel, or both.');
      }
      return { serverId, channelId, phrases: parsed.phrases, sendDm, postInChannel };
    },

    // Never called: a live kind has no schedule (it answers in `handle`).
    run: () =>
      Promise.resolve({
        result: 'Nothing to run: it answers as messages arrive.',
        state: {},
        quiet: true,
      }),
  };

  /** Starts listening (in the worker): the plugins now and every 30 seconds, connecting as needed. */
  start(): void {
    if (this.timer) return;
    void this.reload();
    this.timer = setInterval(() => void this.reload(), RELOAD_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.disconnect();
  }

  /** Reads the enabled listeners, connects or disconnects, and tells the backoffice how it is. */
  async reload(): Promise<void> {
    try {
      const plugins = await this.prisma.guildPlugin.findMany({
        where: { kind: 'PROFESSION_LISTENER', enabled: true },
        select: { id: true, guildId: true, name: true, config: true },
      });
      const listeners = new Map<
        string,
        { id: string; guildId: string; name: string; config: ProfessionListenerConfig }[]
      >();
      for (const plugin of plugins) {
        const config = plugin.config as unknown as ProfessionListenerConfig;
        const list = listeners.get(config.channelId) ?? [];
        list.push({ ...plugin, config });
        listeners.set(config.channelId, list);
      }
      this.listeners = listeners;
      if (listeners.size === 0) await this.disconnect();
      else if (!this.client && !this.connecting && Date.now() >= this.retryAt) await this.connect();
      this.prune();
    } catch (error) {
      this.logger.error(`Profession listeners reload failed: ${String(error)}`);
    }
    await this.cache.set(STATUS_KEY, this.status, STATUS_TTL_MS).catch(() => undefined);
  }

  private async connect(): Promise<void> {
    this.connecting = true;
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    client.once(Events.ClientReady, (ready) =>
      this.logger.log(`Profession listener connected as ${ready.user.tag}`),
    );
    client.on(Events.MessageCreate, (message) => this.onMessage(message, client));
    client.on(Events.Error, (error) =>
      this.logger.error(`Profession listener gateway error: ${error.message}`),
    );
    try {
      await client.login(this.config.getOrThrow<string>('DISCORD_TOKEN'));
      this.client = client;
      this.status = { state: 'listening' };
    } catch (error) {
      await client.destroy().catch(() => undefined);
      const refused = /disallowed intents/i.test(String(error));
      this.status = refused
        ? { state: 'refused' }
        : { state: 'failed', error: error instanceof Error ? error.message : String(error) };
      this.retryAt = Date.now() + (refused ? RETRY_REFUSED_MS : RETRY_FAILED_MS);
      this.logger.warn(
        refused
          ? 'Profession listener: Discord refused the Message Content intent (turn it on in the Developer Portal, Bot tab).'
          : `Profession listener could not connect: ${String(error)}`,
      );
    } finally {
      this.connecting = false;
    }
  }

  private async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.status = { state: 'idle' };
    await client?.destroy().catch(() => undefined);
  }

  private onMessage(message: Message, client: Client): void {
    if (!message.guildId || !this.listeners.has(message.channelId)) return;
    if (message.author.id === client.user?.id) return;
    const embed = message.embeds[0];
    const relayed = message.author.bot || message.webhookId !== null;
    void this.handle({
      serverId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      text: message.content || embed?.description || '',
      authorId: message.author.id,
      authorName: message.member?.displayName ?? message.author.displayName,
      relayed,
      relayName: message.webhookId ? message.author.username : (embed?.author?.name ?? null),
      // Posted by an app as the person (no webhook): the game's guild chat, under their account.
      replyable: !(message.applicationId && !message.webhookId),
    }).catch((error: unknown) =>
      this.logger.error(`Profession listener failed on a message: ${String(error)}`),
    );
  }

  /** Answers `message` if it asks who can craft something its guild can. Never throws for Discord. */
  async handle(message: ChatMessage, now = Date.now()): Promise<void> {
    for (const plugin of this.listeners.get(message.channelId) ?? []) {
      if (plugin.config.serverId !== message.serverId) continue;
      const relay = message.relayed ? relayedAuthor(message.text, message.relayName) : null;
      const question = findQuestion(relay?.text ?? message.text, plugin.config.phrases);
      if (!question) continue;
      const professions = await this.recipesOf(plugin.guildId, now);
      const matches = matchRecipes(question, professions.recipes);
      if (matches.length === 0) continue;

      const asker = relay
        ? await this.relayedAsker(plugin.guildId, relay.names, message)
        : { discordUserId: message.authorId, label: message.authorName, key: message.authorId };
      // Someone from the game with no Discord account, and no answer in the channel: nobody to tell.
      if (!plugin.config.postInChannel && !asker.discordUserId) continue;
      const shown = merged(matches.map((match) => match.recipe));
      const key = `${plugin.id}|${asker.key}|${shown.map((r) => r.name).join('|')}`;
      const recent = (way: 'dm' | 'channel') =>
        (this.answered.get(`${key}|${way}`) ?? 0) > now - COOLDOWN_MS;
      const ways = {
        dm: plugin.config.sendDm && !recent('dm'),
        channel: plugin.config.postInChannel && !recent('channel'),
      };
      if (!ways.dm && !ways.channel) {
        // Answered a moment ago: said in the Log, so a missing answer can be explained.
        await this.log(
          plugin.id,
          now,
          `${asker.label} asked about ${recipeList(shown)} again: answered less than 10 minutes ago, so not again yet.`,
          null,
          { quiet: true },
        );
        continue;
      }
      const delivered = await this.answer(
        plugin,
        message,
        question,
        asker,
        shown,
        professions,
        ways,
        now,
      );
      for (const way of delivered) this.answered.set(`${key}|${way}`, now);
    }
  }

  private async answer(
    plugin: { id: string; config: ProfessionListenerConfig },
    message: ChatMessage,
    question: CrafterQuestion,
    asker: Asker,
    recipes: MergedRecipe[],
    professions: GuildProfessionsDto & { owners: Map<string, string> },
    ways: { dm: boolean; channel: boolean },
    startedAt: number,
  ): Promise<('dm' | 'channel')[]> {
    const characters = new Map(professions.characters.map((c) => [c.id, c]));
    const lines = answerLines(
      recipes.map((recipe) => ({
        name: recipe.name,
        url: recipe.url,
        crafters: [...recipe.crafterIds]
          .map((id) => characters.get(id))
          .filter((c): c is NonNullable<typeof c> => !!c)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({
            character: c.name,
            discordUserId: c.discordUserId,
            discordName: c.discordName,
          })),
      })),
    );
    const done: string[] = [];
    const errors: string[] = [];
    const delivered: ('dm' | 'channel')[] = [];
    if (ways.dm) {
      if (!asker.discordUserId) {
        done.push('no DM (no Discord account linked)');
      } else {
        const link = `https://discord.com/channels/${message.serverId}/${message.channelId}/${message.messageId}`;
        try {
          await this.bot.sendDirectText(
            asker.discordUserId,
            `Who can craft what you [asked about](<${link}>):\n${lines}`,
          );
          done.push('sent a DM');
          delivered.push('dm');
        } catch (error) {
          errors.push(
            isDiscordError(error, 50007)
              ? `Could not DM ${asker.label}: they don’t accept direct messages from this server.`
              : `Could not DM ${asker.label}: ${describeDiscordError(error)}`,
          );
        }
      }
    }
    if (ways.channel) {
      try {
        await this.postInChannel(message, asker, lines);
        done.push('answered in the channel');
        delivered.push('channel');
      } catch (error) {
        errors.push(`Could not answer in the channel: ${describeDiscordError(error)}`);
      }
    }
    const crafters = new Set(recipes.flatMap((recipe) => [...recipe.crafterIds])).size;
    const result = `${asker.label} asked “${question.phrase}” about ${recipeList(recipes)}: ${crafters} crafter${crafters === 1 ? '' : 's'}${done.length > 0 ? `, ${done.join(', ')}` : ''}.`;
    await this.log(plugin.id, startedAt, result, errors.length > 0 ? errors.join(' ') : null);
    return delivered;
  }

  /**
   * The answer in the channel: a reply to the question when Discord allows one, else (a message the
   * game's app posted as the person, or a reply refused) a message of its own that names who asked,
   * a mention that pings nobody.
   */
  private async postInChannel(message: ChatMessage, asker: Asker, lines: string): Promise<void> {
    if (message.replyable) {
      try {
        await this.bot.sendRichMessage(message.channelId, {
          content: lines,
          replyTo: message.messageId,
          suppressEmbeds: true,
        });
        return;
      } catch (error) {
        // Without the right to post at all, a message of its own would fail the same way.
        if (isDiscordError(error, 50013) || isDiscordError(error, 50001)) throw error;
      }
    }
    const who = asker.discordUserId
      ? `<@${asker.discordUserId}>`
      : `**${escapeMarkdown(asker.label)}**`;
    await this.bot.sendRichMessage(message.channelId, {
      content: `For ${who}:\n${lines}`,
      suppressEmbeds: true,
    });
  }

  /** Logs an answer as one of the plugin's runs, as the Plugins tab shows them. */
  private async log(
    pluginId: string,
    startedAt: number,
    result: string,
    error: string | null,
    options: { quiet?: boolean } = {},
  ): Promise<void> {
    const status = error ? 'FAILED' : 'SUCCESS';
    try {
      await this.prisma.pluginRun.create({
        data: {
          pluginId,
          startedAt: new Date(startedAt),
          finishedAt: new Date(),
          status,
          result,
          error,
        },
      });
      // A repeat it didn't answer is only in the Log: the card keeps saying how the last answer went.
      if (!options.quiet) {
        await this.prisma.guildPlugin.update({
          where: { id: pluginId },
          data: {
            lastRunAt: new Date(startedAt),
            lastStatus: status,
            lastError: error,
            lastResult: result,
          },
        });
      }
    } catch (caught) {
      // Removed while answering, most likely.
      this.logger.warn(`Could not log an answer of plugin ${pluginId}: ${String(caught)}`);
    }
  }

  /**
   * Who asked, for a message relayed from the game: the guild's character of that name and its
   * player. A name that matches no character (someone not on Guild Assistant) is still answered in
   * the channel, with no DM; one whose characters belong to several players is not guessed.
   */
  private async relayedAsker(
    guildId: string,
    names: readonly string[],
    message: ChatMessage,
  ): Promise<Asker> {
    for (const name of names) {
      const [firstName, lastName] = name.split(' ');
      const characters = await this.prisma.character.findMany({
        where: {
          guilds: { some: { guildId } },
          firstName: { equals: firstName, mode: 'insensitive' },
          ...(lastName ? { lastName: { equals: lastName, mode: 'insensitive' } } : {}),
        },
        select: { player: { select: { discordUserId: true } } },
        take: 5,
      });
      if (characters.length === 0) continue;
      const players = new Set(characters.map((c) => c.player?.discordUserId ?? null));
      const discordUserId = players.size === 1 ? [...players][0] : null;
      return { discordUserId, label: name, key: `name:${name.toLowerCase()}` };
    }
    const name = names[0];
    return name
      ? { discordUserId: null, label: name, key: `name:${name.toLowerCase()}` }
      : { discordUserId: null, label: message.authorName, key: `relay:${message.authorId}` };
  }

  private recipesOf(guildId: string, now: number) {
    const cached = this.recipes.get(guildId);
    if (cached && cached.at > now - RECIPES_MS) return cached.data;
    const data = this.guildRecipes.guildRecipes(guildId);
    this.recipes.set(guildId, { at: now, data });
    data.catch(() => this.recipes.delete(guildId));
    return data;
  }

  /** Forgets old answers and recipes, so the maps don't grow. */
  private prune(now = Date.now()): void {
    for (const [key, at] of this.answered) if (at <= now - COOLDOWN_MS) this.answered.delete(key);
    for (const [key, entry] of this.recipes)
      if (entry.at <= now - RECIPES_MS) this.recipes.delete(key);
  }

  /** For tests: the listeners as if reloaded. */
  setListeners(
    plugins: { id: string; guildId: string; name: string; config: ProfessionListenerConfig }[],
  ): void {
    this.listeners = new Map();
    for (const plugin of plugins) {
      const list = this.listeners.get(plugin.config.channelId) ?? [];
      list.push(plugin);
      this.listeners.set(plugin.config.channelId, list);
    }
  }
}

/** A recipe of an answer: the same name under two professions (or as spell and item) is one. */
interface MergedRecipe {
  name: string;
  url: string;
  crafterIds: Set<string>;
}

function merged(recipes: readonly GuildRecipe[]): MergedRecipe[] {
  const byName = new Map<string, MergedRecipe>();
  for (const recipe of recipes) {
    const name = recipe.name ?? `${recipe.kind === 'spell' ? 'Spell' : 'Item'} ${recipe.id}`;
    const entry = byName.get(name.toLowerCase()) ?? {
      name,
      url: recipe.url,
      crafterIds: new Set(),
    };
    for (const id of recipe.crafterIds) entry.crafterIds.add(id);
    byName.set(name.toLowerCase(), entry);
  }
  return [...byName.values()];
}
