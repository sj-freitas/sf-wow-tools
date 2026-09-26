import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma, ScheduledTask } from '@prisma/client';
import { formatCharacterName } from '../characters/character-name';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError, isDiscordError, UNKNOWN_MESSAGE } from '../discord/discord-errors';
import {
  hashReactors,
  needsMains,
  parseDynamicTokens,
  renderContent,
  trackingKey,
  type DynamicToken,
  type Reactor,
  type ReactorFormat,
} from './dynamic-content';
import { embedsShown, type PostConfig, type PostState } from './post-task';

/** Channels asked at once while looking for a message by its id. */
const SEARCH_PARALLEL = 8;

const isLive = (state: PostState): boolean => Boolean(state.messageId) && !state.messageDeleted;

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
      if (token.ref === 'self') {
        if (selfId) sources.set(token.ref, { taskId: selfId });
      } else if (token.message) {
        sources.set(token.ref, { message: await this.checkMessage(guildId, token) });
      } else if (token.ref.startsWith('msgid:')) {
        sources.set(token.ref, { message: await this.findMessageById(guildId, token) });
      } else {
        sources.set(token.ref, { taskId: await this.postByName(guildId, token) });
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
    const task = await this.prisma.scheduledTask.findFirst({
      where: { guildId, state: { path: ['messageId'], equals: messageId } },
    });
    const state = task ? (task.state as PostState) : {};
    if (task && state.channelId) return { channelId: state.channelId, messageId };

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
      return this.locationOfTask(task);
    }
    return source.message ?? null;
  }

  /** The message a scheduled post has in Discord, if it is up. */
  locationOfTask(task: ScheduledTask | null | undefined): MessageLocation | null {
    const state = task ? (task.state as PostState) : {};
    return isLive(state) && state.channelId && state.messageId
      ? { channelId: state.channelId, messageId: state.messageId }
      : null;
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
      const reactors = await this.readReactors(
        await this.locate(sources.get(token.ref)),
        token.emoji,
      );
      people.set(
        key,
        needsMains(token.format) ? await this.withMains(guildId, reactors) : reactors,
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
   * Adds the main characters each person has in the guild (`mains`, one entry per character).
   * Someone with no main character has none, and the `mainNames` preset then shows their Discord name.
   */
  async withMains(guildId: string, reactors: readonly Reactor[]): Promise<Reactor[]> {
    if (reactors.length === 0) return [];
    const players = await this.prisma.player.findMany({
      where: { guildId, discordUserId: { in: reactors.map((reactor) => reactor.id) } },
      select: {
        discordUserId: true,
        characters: {
          where: { isMain: true },
          orderBy: { createdAt: 'asc' },
          select: { firstName: true, lastName: true },
        },
      },
    });
    const mains = new Map(
      players.map((player) => [
        player.discordUserId,
        player.characters.map((character) => formatCharacterName(character)),
      ]),
    );
    return reactors.map((reactor) => ({ ...reactor, mains: mains.get(reactor.id) ?? [] }));
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
      trackingKey({ ref: row.postRef, emoji: row.emoji, format: row.type as ReactorFormat });
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
          type: token.format,
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
      const changedTasks = new Map<string, ScheduledTask>();
      for (const row of rows) {
        if (!isLive(row.task.state as PostState)) continue;
        try {
          const read = await this.readReactors(
            row.sourceTask
              ? this.locationOfTask(row.sourceTask)
              : (sourceOfRow(row).message ?? null),
            row.emoji,
          );
          // Main characters are part of what is compared, so a new main updates the post too.
          const reactors = needsMains(row.type as ReactorFormat)
            ? await this.withMains(row.task.guildId, read)
            : read;
          const hash = hashReactors(reactors);
          if (hash === row.lastHash) continue;
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
            )
          )
            edited++;
        } catch (error) {
          this.logger.warn(`Could not update post ${task.id}: ${describeDiscordError(error)}`);
        }
      }
    } catch (error) {
      this.logger.error(`Refreshing tracked posts failed: ${String(error)}`);
    }
    return edited;
  }

  /** Writes the post's text with the latest people into Discord, if that changes the message. */
  private async rerender(
    task: ScheduledTask,
    rows: { postRef: string; emoji: string; type: string; lastUsers: Prisma.JsonValue }[],
  ): Promise<boolean> {
    const config = task.config as unknown as PostConfig;
    const state = task.state as PostState;
    const tokens = parseDynamicTokens(config.content);
    const people: PeopleByKey = new Map(
      rows.map((row) => [
        trackingKey({ ref: row.postRef, emoji: row.emoji, format: row.type as ReactorFormat }),
        row.lastUsers as unknown as Reactor[],
      ]),
    );
    const rendered = await renderContent(config.content, tokens, people);
    if (rendered === state.renderedContent || !state.channelId || !state.messageId) return false;
    try {
      await this.bot.editMessage(state.channelId, state.messageId, rendered, {
        suppressEmbeds: !embedsShown(config),
        quiet: true,
      });
    } catch (error) {
      if (isDiscordError(error, UNKNOWN_MESSAGE)) {
        await this.prisma.scheduledTask.update({
          where: { id: task.id },
          data: { state: { ...state, messageDeleted: true } },
        });
        return false;
      }
      throw error;
    }
    await this.prisma.scheduledTask.update({
      where: { id: task.id },
      data: { state: { ...state, renderedContent: rendered } },
    });
    return true;
  }
}

/** Discord's "Unknown Emoji" error code. */
const UNKNOWN_EMOJI = 10014;

/** What a tracking row points at. */
function sourceOfRow(row: {
  sourceTaskId: string | null;
  sourceChannelId: string | null;
  sourceMessageId: string | null;
}): Source {
  return {
    ...(row.sourceTaskId ? { taskId: row.sourceTaskId } : {}),
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
