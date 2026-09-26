import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma, Role, ScheduledTask } from '@prisma/client';
import { formatCharacterName } from '../characters/character-name';
import { ROLE_LABELS } from '../characters/role-labels';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService, type GuildMemberInfo } from '../discord/discord-bot.service';
import { describeDiscordError, isDiscordError, UNKNOWN_MESSAGE } from '../discord/discord-errors';
import {
  hasRosterTokens,
  hashReactors,
  hashRoster,
  parseRosterTokens,
  type RosterData,
  parseDynamicTokens,
  renderContent,
  trackingKey,
  type DynamicToken,
  type Reactor,
  type ReactorCharacter,
} from './dynamic-content';
import type { ShowRosterEntry } from './show-sandbox';
import {
  isLive,
  liveMessageOf,
  type PostConfig,
  type PostedPart,
  type PostState,
} from './post-task';

/** Channels asked at once while looking for a message by its id. */
const SEARCH_PARALLEL = 8;
/** The nicknames and roles of a guild's players are kept this long. */
const MEMBER_INFO_TTL_MS = 5 * 60 * 1000;
/** Most people whose server nickname is looked up in one go (the rest show their Discord name). */
const MAX_NICKNAME_LOOKUPS = 100;

/** A message in Discord: where reactions are read. */
export interface MessageLocation {
  channelId: string;
  messageId: string;
}

/**
 * What a tag reads the reactions of: a scheduled post of the bot (whose message is looked up each
 * time, since it may not be posted yet or be posted again), or any other message by its location.
 */
export interface Source {
  taskId?: string;
  /** For a scheduled post: which of its messages, from 1. */
  part?: number;
  message?: MessageLocation;
}

/** Which message each tag's `ref` stands for. */
export type SourceMap = Map<string, Source>;

/** Who reacted, by tracking key (see `trackingKey`). */
export type PeopleByKey = Map<string, Reactor[]>;

/**
 * The dynamic features of posts: `{{reactions sourcePost=… emoji=… show=…}}` in a post's text is
 * replaced by the people who reacted. Saving a post keeps its tracking rows in line with its text;
 * the worker then re-reads the reactions every minute and edits the Discord message when they
 * changed. A cheap hash of who reacted tells whether anything did.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  /**
   * Finds what each token points at: a scheduled post by name (case does not matter), `self`, a
   * Discord message id (of a message the bot posted), or a message link (any message in one of the
   * guild's servers that the bot can read). Throws when it cannot be found, is not in this guild,
   * or a name is shared by two posts, so a wrong tag is refused on save. `selfId` is unknown while
   * a post is being created; its own tags wait.
   */
  async resolveSources(
    guildId: string,
    tokens: readonly DynamicToken[],
    selfId?: string,
  ): Promise<SourceMap> {
    const sources: SourceMap = new Map();
    for (const token of tokens) {
      if (sources.has(token.ref)) continue;
      if (token.ref.startsWith('self#')) {
        if (selfId) sources.set(token.ref, { taskId: selfId, part: token.part });
      } else if (token.message) {
        sources.set(token.ref, { message: await this.checkMessage(guildId, token) });
      } else if (token.ref.startsWith('msgid:')) {
        sources.set(token.ref, { message: await this.findMessageById(guildId, token) });
      } else {
        sources.set(token.ref, {
          taskId: await this.postByName(guildId, token),
          part: token.part,
        });
      }
    }
    return sources;
  }

  private async postByName(guildId: string, token: DynamicToken): Promise<string> {
    const matches = await this.prisma.scheduledTask.findMany({
      where: { guildId, name: { equals: token.label.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    if (matches.length === 0) {
      throw new BadRequestException(
        `There is no post named "${token.label}" in this guild. To read another message, use its link (right-click → Copy Message Link).`,
      );
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        `${matches.length} posts are named "${token.label}": rename one, or use its message link.`,
      );
    }
    return matches[0].id;
  }

  /**
   * A bare message id says which message but not where, so it is looked for: first among the posts
   * the bot made (instant), then in every text channel of the guild's servers that the bot can see.
   * Whatever is found is remembered as channel + message, so this happens once, on save.
   */
  private async findMessageById(guildId: string, token: DynamicToken): Promise<MessageLocation> {
    const messageId = token.ref.slice('msgid:'.length);
    // A guild has few posts, so look through their messages here.
    const tasks = await this.prisma.scheduledTask.findMany({
      where: { guildId },
      select: { state: true },
    });
    for (const task of tasks) {
      const posted = ((task.state as PostState).messages ?? []).find(
        (message) => message.messageId === messageId,
      );
      if (posted) return { channelId: posted.channelId, messageId };
    }

    const servers = await this.prisma.discordServer.findMany({
      where: { guildId },
      select: { discordId: true },
    });
    const channelIds: string[] = [];
    for (const server of servers) {
      try {
        channelIds.push(...(await this.bot.listTextChannels(server.discordId)).map((c) => c.id));
      } catch (error) {
        this.logger.warn(
          `Could not list the channels of ${server.discordId}: ${describeDiscordError(error)}`,
        );
      }
    }
    let found: string | null = null;
    for (let i = 0; i < channelIds.length && !found; i += SEARCH_PARALLEL) {
      const batch = channelIds.slice(i, i + SEARCH_PARALLEL);
      const hits = await Promise.all(
        batch.map(async (channelId) =>
          (await this.bot.messageExists(channelId, messageId)) ? channelId : null,
        ),
      );
      found = hits.find((channelId) => channelId !== null) ?? null;
    }
    if (!found) {
      throw new BadRequestException(
        `No message with the id ${token.label} was found in the channels of this guild's servers that the bot can read (it needs View Channel and Read Message History). For a message in a thread, use its link (right-click → Copy Message Link).`,
      );
    }
    return { channelId: found, messageId };
  }

  /** A message link is accepted when its server belongs to this guild and the bot can read it. */
  private async checkMessage(guildId: string, token: DynamicToken): Promise<MessageLocation> {
    const link = token.message;
    if (!link) throw new Error('not a message link');
    const server = await this.prisma.discordServer.findFirst({
      where: { guildId, discordId: link.serverId },
      select: { id: true },
    });
    if (!server) {
      throw new BadRequestException(
        `${token.label} is in a server that is not part of this guild, so its reactions cannot be shown here.`,
      );
    }
    try {
      // The channel must really be in that server (a link can be edited by hand).
      if ((await this.bot.getChannelServerId(link.channelId)) !== link.serverId) {
        throw new BadRequestException(`${token.label} does not point at a channel of that server.`);
      }
      await this.bot.assertCanReadMessage(link.channelId, link.messageId);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `The bot cannot read ${token.label} (${describeDiscordError(error)}). It needs to see the channel and read its history.`,
      );
    }
    return { channelId: link.channelId, messageId: link.messageId };
  }

  /**
   * What a saved post's tags point at, for the worker and for posting: what was found when the
   * post was saved (so renaming another post does not break this one), else looked up now.
   */
  async sourceMap(
    taskId: string,
    guildId: string,
    tokens: readonly DynamicToken[],
  ): Promise<SourceMap> {
    const sources: SourceMap = new Map();
    for (const row of await this.prisma.postTracking.findMany({ where: { taskId } })) {
      sources.set(row.postRef, sourceOfRow(row));
    }
    const missing = tokens.filter((token) => !sources.has(token.ref));
    if (missing.length > 0) {
      try {
        for (const [ref, source] of await this.resolveSources(guildId, missing, taskId)) {
          sources.set(ref, source);
        }
      } catch {
        // A tag that points nowhere shows as nobody.
      }
    }
    return sources;
  }

  /** Where a source's message is in Discord right now, or null (a post that is not up). */
  async locate(source: Source | undefined): Promise<MessageLocation | null> {
    if (!source) return null;
    if (source.taskId) {
      const task = await this.prisma.scheduledTask.findUnique({ where: { id: source.taskId } });
      return this.locationOfTask(task, source.part);
    }
    return source.message ?? null;
  }

  /** The message a scheduled post has in Discord for one of its parts (from 1), if it is up. */
  locationOfTask(task: ScheduledTask | null | undefined, part = 1): MessageLocation | null {
    if (!task) return null;
    const config = task.config as unknown as PostConfig;
    const target = config.parts?.[part - 1];
    const posted = target ? liveMessageOf(task.state as PostState, target.id) : undefined;
    return posted ? { channelId: posted.channelId, messageId: posted.messageId } : null;
  }

  /**
   * Reads, from Discord, who reacted for every token now. A post that is not in Discord (yet)
   * has no reactions. Other Discord errors are thrown: better than showing wrong people.
   */
  async fetchPeople(
    guildId: string,
    tokens: readonly DynamicToken[],
    sources: SourceMap,
  ): Promise<PeopleByKey> {
    const people: PeopleByKey = new Map();
    for (const token of tokens) {
      const key = trackingKey(token);
      if (people.has(key)) continue;
      const location = await this.locate(sources.get(token.ref));
      const reactors = await this.readReactors(location, token.emoji);
      people.set(
        key,
        await this.withDisplayNames(location, await this.withCharacters(guildId, reactors)),
      );
    }
    return people;
  }

  /** Who reacted to a message with an emoji, without the bot itself. */
  async readReactors(location: MessageLocation | null, emoji: string): Promise<Reactor[]> {
    if (!location) return [];
    try {
      const [users, botId] = await Promise.all([
        this.bot.getReactionUsers(location.channelId, location.messageId, emoji),
        this.bot.getBotUserId(),
      ]);
      return users.filter((user) => user.id !== botId);
    } catch (error) {
      // The message (or the emoji's reactions) is gone: nobody reacted.
      if (isDiscordError(error, UNKNOWN_MESSAGE) || isDiscordError(error, UNKNOWN_EMOJI)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Adds the characters each person has in the guild (`characters`: main first, then the others
   * by when they were added). Someone with no characters has an empty list.
   */
  async withCharacters(guildId: string, reactors: readonly Reactor[]): Promise<Reactor[]> {
    if (reactors.length === 0) return [];
    const players = await this.prisma.player.findMany({
      where: { guildId, discordUserId: { in: reactors.map((reactor) => reactor.id) } },
      select: {
        discordUserId: true,
        characters: {
          orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
          select: {
            firstName: true,
            lastName: true,
            isMain: true,
            class: true,
            roles: true,
            level: true,
          },
        },
      },
    });
    const byPerson = new Map(
      players.map((player) => [player.discordUserId, player.characters.map(toCharacter)]),
    );
    return reactors.map((reactor) => ({ ...reactor, characters: byPerson.get(reactor.id) ?? [] }));
  }

  /**
   * Every character of the guild, each with who plays it, sorted by name (so the same roster
   * always gives the same list, and the same hash). This is what `{{roster …}}` tags work with.
   */
  async loadRoster(guildId: string): Promise<ShowRosterEntry[]> {
    const players = await this.prisma.player.findMany({
      where: { guildId },
      select: {
        discordUserId: true,
        discordUsername: true,
        discordDisplayName: true,
        characters: {
          select: {
            firstName: true,
            lastName: true,
            isMain: true,
            class: true,
            roles: true,
            level: true,
          },
        },
      },
    });
    const withCharacters = players.filter((player) => player.characters.length > 0);
    const members = await this.memberInfo(
      guildId,
      withCharacters.map((player) => player.discordUserId),
    );
    return withCharacters
      .flatMap((player) => {
        const name = player.discordDisplayName ?? player.discordUsername ?? player.discordUserId;
        const member = members.get(player.discordUserId);
        return player.characters.map((character): ShowRosterEntry => ({
          ...toCharacter(character),
          discordUser: {
            id: player.discordUserId,
            tag: `<@${player.discordUserId}>`,
            name,
            displayName: member?.displayName ?? name,
            roles: member?.roles ?? [],
          },
        }));
      })
      .sort(
        (a, b) => a.name.localeCompare(b.name) || a.discordUser.id.localeCompare(b.discordUser.id),
      );
  }

  private readonly memberCache = new Map<
    string,
    { at: number; info: Map<string, { displayName?: string; roles: string[] }> }
  >();

  /**
   * How the guild's players are in its main server: their nickname there and the names of their
   * Discord roles. One member listing and one role listing when Discord allows it (the bot's Server
   * Members Intent), otherwise one lookup per player (at most a hundred). Kept for a few minutes,
   * so a roster checked every minute does not call Discord every minute. If Discord cannot be
   * reached, nothing is known and nothing is kept (players show their Discord name and no roles).
   */
  private async memberInfo(
    guildId: string,
    playerIds: readonly string[],
  ): Promise<Map<string, { displayName?: string; roles: string[] }>> {
    const cached = this.memberCache.get(guildId);
    if (cached && Date.now() - cached.at < MEMBER_INFO_TTL_MS) return cached.info;
    const info = new Map<string, { displayName?: string; roles: string[] }>();
    try {
      const main = await this.prisma.discordServer.findFirst({
        where: { guildId, isMain: true },
        select: { discordId: true },
      });
      if (!main || playerIds.length === 0) return info;
      const roleNames = new Map(
        (await this.bot.listRoles(main.discordId)).map((role) => [role.id, role.name]),
      );
      let members: GuildMemberInfo[];
      try {
        members = await this.bot.listGuildMembers(main.discordId);
      } catch {
        const found = await Promise.all(
          playerIds
            .slice(0, MAX_NICKNAME_LOOKUPS)
            .map((id) => this.bot.getGuildMember(main.discordId, id)),
        );
        members = found.filter((member): member is GuildMemberInfo => member !== null);
      }
      for (const member of members) {
        info.set(member.id, {
          ...(member.nick ? { displayName: member.nick } : {}),
          roles: member.roles.flatMap((id) => roleNames.get(id) ?? []),
        });
      }
    } catch (error) {
      this.logger.warn(
        `Could not read the guild's members from Discord: ${describeDiscordError(error)}`,
      );
      return info;
    }
    this.memberCache.set(guildId, { at: Date.now(), info });
    return info;
  }

  /**
   * What the roster tags of a message's text work with: the guild's characters, loaded only when
   * the text has such tags (once per guild, when a `cache` is passed).
   */
  async rosterOf(
    guildId: string,
    content: string,
    cache: Map<string, RosterSnapshot> = new Map(),
  ): Promise<RosterData | undefined> {
    if (!hasRosterTokens(content)) return undefined;
    const tokens = parseRosterTokens(content);
    if (tokens.length === 0) return undefined;
    return { tokens, entries: (await this.rosterSnapshot(guildId, cache)).entries };
  }

  private async rosterSnapshot(
    guildId: string,
    cache: Map<string, RosterSnapshot>,
  ): Promise<RosterSnapshot> {
    let snapshot = cache.get(guildId);
    if (!snapshot) {
      const entries = await this.loadRoster(guildId);
      snapshot = { entries, hash: hashRoster(entries) };
      cache.set(guildId, snapshot);
    }
    return snapshot;
  }

  /**
   * Adds how each person is shown in the message's server (`displayName`: their nickname there).
   * That is one Discord lookup per person, so people already looked up (`known`, from the last check)
   * are not asked again, and at most a hundred are looked up at a time. Someone who cannot be found
   * (they left the server) keeps their Discord name.
   */
  async withDisplayNames(
    location: MessageLocation | null,
    reactors: readonly Reactor[],
    known: readonly Reactor[] = [],
  ): Promise<Reactor[]> {
    if (reactors.length === 0 || !location) return [...reactors];
    const serverId = await this.serverOf(location.channelId);
    const already = new Map(known.map((person) => [person.id, person.displayName]));
    const missing = reactors
      .filter((person) => !already.get(person.id))
      .slice(0, MAX_NICKNAME_LOOKUPS);
    const found = new Map<string, string>();
    for (let i = 0; i < missing.length && serverId; i += SEARCH_PARALLEL) {
      await Promise.all(
        missing.slice(i, i + SEARCH_PARALLEL).map(async (person) => {
          const name = await this.bot.getMemberDisplayName(serverId, person.id);
          if (name) found.set(person.id, name);
        }),
      );
    }
    return reactors.map((person) => ({
      ...person,
      displayName: already.get(person.id) || found.get(person.id) || person.name,
    }));
  }

  private readonly channelServers = new Map<string, string | null>();

  /** The server a channel is in; a channel never moves, so it is asked once. */
  private async serverOf(channelId: string): Promise<string | null> {
    if (!this.channelServers.has(channelId)) {
      try {
        this.channelServers.set(channelId, await this.bot.getChannelServerId(channelId));
      } catch {
        return null;
      }
    }
    return this.channelServers.get(channelId) ?? null;
  }

  /**
   * Makes the post's tracking rows match its text: rows for tags that are gone are removed, rows
   * for new tags are added. `people` (from `fetchPeople`) seeds the rows so the worker does not
   * find a "change" straight away.
   */
  async syncTracking(
    taskId: string,
    tokens: readonly DynamicToken[],
    sources: SourceMap,
    people?: PeopleByKey,
  ): Promise<void> {
    const wanted = new Map(tokens.map((token) => [trackingKey(token), token]));
    const rows = await this.prisma.postTracking.findMany({ where: { taskId } });
    const rowKey = (row: { postRef: string; emoji: string; type: string }) =>
      trackingKey({ ref: row.postRef, emoji: row.emoji });
    const have = new Map(rows.map((row) => [rowKey(row), row]));

    const stale = rows.filter((row) => !wanted.has(rowKey(row)));
    if (stale.length > 0) {
      await this.prisma.postTracking.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
    }
    for (const [key, token] of wanted) {
      const source = sources.get(token.ref);
      if (!source) continue;
      const target = sourceColumns(source);
      const existing = have.get(key);
      if (existing) {
        // The tag may now point somewhere else (the name was moved to another post): follow it.
        if (
          existing.sourceTaskId !== target.sourceTaskId ||
          existing.sourceChannelId !== target.sourceChannelId ||
          existing.sourceMessageId !== target.sourceMessageId
        ) {
          await this.prisma.postTracking.update({
            where: { id: existing.id },
            data: { ...target, lastHash: null },
          });
        }
        continue;
      }
      const users = people?.get(key);
      await this.prisma.postTracking.create({
        data: {
          taskId,
          ...target,
          postRef: token.ref,
          emoji: token.emoji,
          type: 'custom',
          ...(users
            ? {
                lastHash: hashReactors(users),
                lastUsers: users as unknown as Prisma.InputJsonValue,
                checkedAt: new Date(),
              }
            : {}),
        },
      });
    }
  }

  /** One pass of the worker: refresh every live post that has dynamic features. Never throws. */
  async refreshDue(): Promise<number> {
    let edited = 0;
    try {
      const rows = await this.prisma.postTracking.findMany({
        include: { task: true, sourceTask: true },
        orderBy: [{ taskId: 'asc' }, { createdAt: 'asc' }],
      });
      const rosters = new Map<string, RosterSnapshot>();
      const changedTasks = new Map<string, ScheduledTask>();
      for (const row of rows) {
        if (!isLive(row.task.state as PostState)) continue;
        try {
          const source = sourceOfRow(row);
          const location = row.sourceTask
            ? this.locationOfTask(row.sourceTask, source.part)
            : (source.message ?? null);
          const read = await this.readReactors(location, row.emoji);
          // Main characters are part of what is compared, so a new main updates the post too.
          const withCharacters = await this.withCharacters(row.task.guildId, read);
          const hash = hashReactors(withCharacters);
          if (hash === row.lastHash) continue;
          // Only now, that something changed, ask for nicknames (and only of people not seen before).
          const reactors = await this.withDisplayNames(
            location,
            withCharacters,
            row.lastUsers as unknown as Reactor[],
          );
          await this.prisma.postTracking.update({
            where: { id: row.id },
            data: {
              lastHash: hash,
              lastUsers: reactors as unknown as Prisma.InputJsonValue,
              checkedAt: new Date(),
            },
          });
          row.lastUsers = reactors as unknown as Prisma.JsonValue;
          changedTasks.set(row.taskId, row.task);
        } catch (error) {
          this.logger.warn(`Could not read reactions for post ${row.taskId}: ${String(error)}`);
        }
      }
      for (const task of changedTasks.values()) {
        try {
          if (
            await this.rerender(
              task,
              rows.filter((row) => row.taskId === task.id),
              rosters,
            )
          )
            edited++;
        } catch (error) {
          this.logger.warn(`Could not update post ${task.id}: ${describeDiscordError(error)}`);
        }
      }
      edited += await this.refreshRosterPosts(rosters);
    } catch (error) {
      this.logger.error(`Refreshing tracked posts failed: ${String(error)}`);
    }
    return edited;
  }

  /**
   * Writes each message's text with the latest people into Discord, for the messages whose text
   * changes by it. Returns whether any message was edited.
   */
  private async rerender(
    task: ScheduledTask,
    rows: { postRef: string; emoji: string; type: string; lastUsers: Prisma.JsonValue }[],
    rosters: Map<string, RosterSnapshot>,
    rosterHash?: string,
  ): Promise<boolean> {
    const config = task.config as unknown as PostConfig;
    const state = task.state as PostState;
    const people: PeopleByKey = new Map(
      rows.map((row) => [
        trackingKey({ ref: row.postRef, emoji: row.emoji }),
        row.lastUsers as unknown as Reactor[],
      ]),
    );
    const original: PostedPart[] = state.messages ?? [];
    let messages = original;
    let edited = false;
    for (const [index, part] of config.parts.entries()) {
      const tokens = parseDynamicTokens(part.content, index + 1);
      const roster = await this.rosterOf(task.guildId, part.content, rosters);
      const posted = liveMessageOf({ messages }, part.id);
      if ((tokens.length === 0 && !roster) || !posted) continue;
      const rendered = await renderContent(part.content, tokens, people, roster);
      if (rendered === posted.renderedContent) continue;
      try {
        await this.bot.editMessage(posted.channelId, posted.messageId, rendered, {
          suppressEmbeds: !posted.embedLinks,
          quiet: true,
        });
        messages = messages.map((m) =>
          m.partId === part.id && !m.deleted ? { ...m, renderedContent: rendered } : m,
        );
        edited = true;
      } catch (error) {
        if (!isDiscordError(error, UNKNOWN_MESSAGE)) throw error;
        messages = messages.map((m) =>
          m.partId === part.id && !m.deleted ? { ...m, deleted: true } : m,
        );
      }
    }
    if (messages !== original || (rosterHash && rosterHash !== state.rosterHash)) {
      await this.prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          state: {
            ...state,
            messages,
            ...(rosterHash ? { rosterHash } : {}),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return edited;
  }

  /**
   * Posts with `{{roster …}}` tags: when the guild's roster is not the one they were last written
   * from (its hash differs), their messages are written again, and edited if that changes them.
   * Most passes find the same hash and do nothing more than one query per guild.
   */
  private async refreshRosterPosts(rosters: Map<string, RosterSnapshot>): Promise<number> {
    const found = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM scheduled_tasks
      WHERE type = 'POST'
        AND config::text LIKE '%{{roster%'
        AND jsonb_array_length(COALESCE(state->'messages', '[]'::jsonb)) > 0`;
    let edited = 0;
    for (const { id } of found) {
      try {
        const task = await this.prisma.scheduledTask.findUnique({ where: { id } });
        if (!task || !isLive(task.state as PostState)) continue;
        const { hash } = await this.rosterSnapshot(task.guildId, rosters);
        if ((task.state as PostState).rosterHash === hash) continue;
        const rows = await this.prisma.postTracking.findMany({ where: { taskId: id } });
        if (await this.rerender(task, rows, rosters, hash)) edited++;
      } catch (error) {
        this.logger.warn(
          `Could not update the roster of post ${id}: ${describeDiscordError(error)}`,
        );
      }
    }
    return edited;
  }
}

/** Discord's "Unknown Emoji" error code. */
const UNKNOWN_EMOJI = 10014;

/** What a tracking row points at (for a scheduled post, which of its messages comes from `#n`). */
function sourceOfRow(row: {
  postRef: string;
  sourceTaskId: string | null;
  sourceChannelId: string | null;
  sourceMessageId: string | null;
}): Source {
  const part = /#(\d+)$/.exec(row.postRef)?.[1];
  return {
    ...(row.sourceTaskId ? { taskId: row.sourceTaskId, part: part ? Number(part) : 1 } : {}),
    ...(row.sourceChannelId && row.sourceMessageId
      ? { message: { channelId: row.sourceChannelId, messageId: row.sourceMessageId } }
      : {}),
  };
}

/** The columns of a tracking row that say where its reactions are read. */
function sourceColumns(source: Source) {
  return {
    sourceTaskId: source.taskId ?? null,
    sourceChannelId: source.message?.channelId ?? null,
    sourceMessageId: source.message?.messageId ?? null,
  };
}

/** A character row as the roster tags and reactions see it. */
function toCharacter(character: {
  firstName: string;
  lastName: string;
  isMain: boolean;
  class: string;
  roles: Role[];
  level: number;
}): ReactorCharacter {
  return {
    name: formatCharacterName(character),
    firstName: character.firstName,
    lastName: character.lastName,
    isMain: character.isMain,
    class: character.class,
    roles: character.roles.map((role) => ROLE_LABELS[role]),
    level: character.level,
  };
}

/** The guild's characters, as loaded once per pass, and their hash. */
type RosterSnapshot = { entries: ShowRosterEntry[]; hash: string };
