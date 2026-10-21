import { createHash } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { siteOrigin } from '../config/site-origin';
import { PrismaService } from '../database/prisma.service';
import { guildPath } from '../guilds/guild-path';
import { parseGuildChannel } from '../plugins/plugin-channel';
import { PluginKindRegistry, type PluginKindDef } from '../plugins/plugin-kinds';
import { GuildRecipesService, type GuildRecipe } from './guild-recipes.service';

/** Discord's limit for one message. */
export const MAX_MESSAGE = 2000;
/** A run soon after an import: by then Wowhead has named most new recipes. */
const AFTER_IMPORT_MS = 2 * 60 * 1000;

/** Where the plugin posts. */
export interface ProfessionsPostConfig {
  serverId: string;
  channelId: string;
}

/** Between runs: what was posted (to tell whether anything changed) and its messages. */
type ProfessionsPostState = {
  hash?: string;
  messageIds?: string[];
};

/** "Copper Rod", or "Spell 1245287" while Wowhead hasn't named it. */
const recipeName = (recipe: GuildRecipe) =>
  recipe.name ?? `${recipe.kind === 'spell' ? 'Spell' : 'Item'} ${recipe.id}`;

/** A crafter as the list shows them: the character, a link to its player on Discord when known. */
export interface Crafter {
  name: string;
  discordUserId: string | null;
}

/** "[Shivan Nightpath](<https://discord.com/users/123>)": the character, opening its player's profile. */
const crafterLink = (crafter: Crafter) =>
  crafter.discordUserId
    ? `[${crafter.name}](<https://discord.com/users/${crafter.discordUserId}>)`
    : crafter.name;

/** What the list starts with: what it is, where to add to it, and /crafter. */
export const listIntro = (professionsUrl: string): string =>
  [
    '# Profession Data',
    `This list updates by itself. Add your professions on [Guild Assistant](<${professionsUrl}>) (Import professions).`,
    'Find who can craft something with `/crafter <recipe name>` anywhere on Discord, or with Discord’s search.',
  ].join('\n');

/**
 * The guild's professions as Discord messages, after `intro`: per profession, each recipe (a
 * Wowhead link) with who can craft it, each crafter linking to their player's Discord profile.
 * Split between messages at line ends, never inside a recipe's line; a profession carried on into
 * the next message repeats its heading. A line too long for one message (a recipe half the guild
 * can craft) shortens its list of crafters to "…, 12 more", linking to the recipe's crafters on the
 * website (`craftersUrl`) when given.
 */
export function professionsMessages(
  recipes: readonly GuildRecipe[],
  crafterOf: (id: string) => Crafter,
  intro = '',
  craftersUrl?: (recipe: GuildRecipe) => string,
): string[] {
  if (recipes.length === 0) {
    return [
      [intro, 'Nobody in the guild has imported their professions yet.']
        .filter(Boolean)
        .join('\n\n'),
    ];
  }
  const messages: string[] = [];
  // The intro and the first profession share the first message, a blank line apart.
  let current = intro ? `${intro}\n` : '';
  let profession: string | null = null;
  for (const recipe of recipes) {
    const heading = `## ${recipe.profession}`;
    const first = recipe.profession !== profession;
    profession = recipe.profession;
    // "Crafters: [A, B]": the brackets escaped, so Discord shows them instead of reading a link.
    const start = `- [${recipeName(recipe)}](<${recipe.url}>): Crafters: \\[`;
    const names = recipe.crafterIds
      .map(crafterOf)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(crafterLink);
    // Room for the heading repeated above it in a new message.
    const room = MAX_MESSAGE - heading.length - ' (continued)\n'.length;
    let line = `${start}${names.join(', ')}\\]`;
    for (let shown = names.length - 1; line.length > room && shown > 0; shown--) {
      const more = `${names.length - shown} more`;
      const rest = craftersUrl ? `[${more}](<${craftersUrl(recipe)}>)` : more;
      line = `${start}${[...names.slice(0, shown), rest].join(', ')}\\]`;
    }
    // A profession's heading always goes with its first recipe, never alone at a message's end.
    const block = first ? `${heading}\n${line}` : line;
    if (current && current.length + 1 + block.length > MAX_MESSAGE) {
      messages.push(current);
      current = first ? block : `${heading} (continued)\n${line}`;
    } else {
      current = current ? `${current}\n${block}` : block;
    }
  }
  messages.push(current);
  return messages;
}

/** Identifies what was posted: the same professions give the same hash. */
export const hashMessages = (messages: readonly string[]): string =>
  createHash('sha256').update(messages.join('\u0000')).digest('hex');

/**
 * Professions List, a plugin kind of professions: posts the guild's professions (what it can
 * craft, and who) in a channel, over as many messages as it takes. On its schedule, and soon after
 * someone imports professions, it checks whether the list changed (a hash of the messages); if it
 * did, it deletes its previous messages and posts the list again. Registered from here, not in
 * `src/plugins`, so professions stay removable on their own.
 */
@Injectable()
export class ProfessionsPostPlugin implements OnModuleInit {
  /** The website, for the intro's link. */
  private readonly origin: string;

  constructor(
    private readonly registry: PluginKindRegistry,
    private readonly guildRecipes: GuildRecipesService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.origin = siteOrigin(config);
  }

  onModuleInit(): void {
    this.registry.add(this.def);
  }

  /** After an import: the guild's Professions Lists check for changes in a couple of minutes. */
  async soon(guildId: string): Promise<void> {
    await this.prisma.guildPlugin.updateMany({
      where: { guildId, kind: 'PROFESSIONS_POST', enabled: true },
      data: { nextRunAt: new Date(Date.now() + AFTER_IMPORT_MS) },
    });
  }

  readonly def: PluginKindDef<ProfessionsPostConfig> = {
    kind: 'PROFESSIONS_POST',
    label: 'Professions List',
    description:
      'Posts what the guild can craft and who, from the professions addon, and posts it again when it changes.',
    // Checking is cheap and only posts on a change, so it may check often.
    scheduleKinds: ['EVERY_5_MINUTES', 'HOURLY', 'DAILY'],

    parseConfig: async (input, context) => {
      const { serverId, channelId } = await parseGuildChannel(
        (input ?? {}) as Record<string, unknown>,
        context,
      );
      return { serverId, channelId };
    },

    run: async (plugin, context) => {
      const state = plugin.state as ProfessionsPostState;
      const { recipes, characters } = await this.guildRecipes.guildRecipes(plugin.guildId);
      const byId = new Map(characters.map((character) => [character.id, character]));
      const guild = await this.prisma.guild.findUniqueOrThrow({
        where: { id: plugin.guildId },
        select: { gameVersion: true, region: true, realm: true, name: true },
      });
      const professionsUrl = `${this.origin}/${guildPath(guild)}/professions`;
      const messages = professionsMessages(
        recipes,
        (id) => ({
          name: byId.get(id)?.name ?? '?',
          discordUserId: byId.get(id)?.discordUserId ?? null,
        }),
        listIntro(professionsUrl),
        // A recipe's crafters on the website: /professions/<spell id>/crafters.
        (recipe) => `${professionsUrl}/${recipe.id}/crafters`,
      );
      const hash = hashMessages(messages);
      if (hash === state.hash && (state.messageIds?.length ?? 0) > 0) {
        return { result: 'No changes.', state, quiet: true };
      }
      const channelId = plugin.config.channelId;
      // The previous list goes first; one already deleted by hand is fine.
      for (const messageId of state.messageIds ?? []) {
        await context.bot.deleteMessage(channelId, messageId).catch(() => undefined);
      }
      const messageIds: string[] = [];
      try {
        for (const content of messages) {
          // No previews: each crafter's Discord link would show a profile card.
          messageIds.push(
            await context.bot.postQuietMessage(channelId, content, { suppressEmbeds: true }),
          );
        }
      } catch (error) {
        // Half a list helps nobody, and the retry posts it all again: take back what went up.
        for (const messageId of messageIds) {
          await context.bot.deleteMessage(channelId, messageId).catch(() => undefined);
        }
        throw error;
      }
      const count = `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`;
      return {
        result: `Posted the list: ${count} in ${messageIds.length} message${messageIds.length === 1 ? '' : 's'}.`,
        state: { hash, messageIds },
      };
    },
  };
}
