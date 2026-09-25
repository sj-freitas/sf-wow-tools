import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ScheduledTask, type TaskRunStatus } from '@prisma/client';
import { DEFAULT_REGION, timezoneOfRegion } from '../config/regions';
import { PrismaService } from '../database/prisma.service';
import { describeDiscordError, isDiscordError, UNKNOWN_MESSAGE } from '../discord/discord-errors';
import {
  DiscordBotService,
  type MessageReaction,
  type ServerChannel,
} from '../discord/discord-bot.service';
import {
  embedsShown,
  messageUrl,
  parseEmbedLinks,
  parsePostContent,
  parseSeedReactions,
  parseSnowflake,
  type PostConfig,
  type PostState,
} from './post-task';
import { clampPage, likePattern, PAGE_SIZE, searchTerms } from './post-search';
import { describeSchedule, instantFromLocal } from './schedule';

export interface TaskDto {
  id: string;
  name: string;
  type: 'POST';
  enabled: boolean;
  schedule: {
    /** When the post goes out, ISO. */
    runAt: string | null;
    /** The same instant as wall-clock "yyyy-MM-ddTHH:mm" in the guild's timezone. */
    runAtLocal: string | null;
    description: string;
  };
  timezone: string;
  /** When the worker will post it; null once posted, paused, deleted or given up on. */
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: TaskRunStatus | null;
  lastError: string | null;
  post: {
    serverId: string;
    channelId: string;
    content: string;
    seedReactions: string[];
    /** Whether Discord shows link previews under the post. */
    embedLinks: boolean;
    posted: { messageId: string; url: string; postedAt: string; messageDeleted: boolean } | null;
  };
}

/** One page of the guild's posts, newest date first. */
export interface TaskPageDto {
  items: TaskDto[];
  /** All posts matching the search, over every page. */
  total: number;
  page: number;
  pageSize: number;
}

export interface ServerChannelsDto {
  serverId: string;
  serverName: string;
  channels: ServerChannel[];
  /** Why the channels could not be read (e.g. the bot is not in the server). */
  error: string | null;
}

export interface TaskInput {
  name?: unknown;
  enabled?: unknown;
  /** When to post, as wall-clock "yyyy-MM-ddTHH:mm" in the guild's timezone. */
  runAtLocal?: unknown;
  /** Post right away instead of at `runAtLocal`. */
  postNow?: unknown;
  serverId?: unknown;
  channelId?: unknown;
  content?: unknown;
  seedReactions?: unknown;
  embedLinks?: unknown;
}

export interface ReactionDto extends MessageReaction {
  /** Image of a custom emoji. */
  imageUrl: string | null;
}

const ALREADY_POSTED =
  'This post is already in Discord. Edit it there, or delete it first to post it again.';

/** A post that is in Discord right now. */
const isLive = (state: PostState): boolean => Boolean(state.messageId) && !state.messageDeleted;

/**
 * When the worker should post next. A post goes out once: never while it is live or paused,
 * and after it was deleted only at a new future date. One that never went out and whose time
 * has passed goes out now, late rather than never.
 */
function nextRunFor(state: PostState, runAt: Date, enabled: boolean, now: Date): Date | null {
  if (!enabled || isLive(state)) return null;
  const future = runAt.getTime() > now.getTime();
  if (state.messageId) return future ? runAt : null;
  return future ? runAt : now;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  /**
   * A page of the guild's posts, ordered by date (newest first, so upcoming posts lead).
   * The search covers every page: each word must appear in the name or the text.
   */
  async list(
    guildId: string,
    options: { query?: string; page?: unknown } = {},
  ): Promise<TaskPageDto> {
    const timezone = await this.timezoneOf(guildId);
    const page = clampPage(options.page);
    const skip = (page - 1) * PAGE_SIZE;
    const terms = searchTerms(options.query);

    let total: number;
    let tasks: ScheduledTask[];
    if (terms.length === 0) {
      [total, tasks] = await Promise.all([
        this.prisma.scheduledTask.count({ where: { guildId } }),
        this.prisma.scheduledTask.findMany({
          where: { guildId },
          orderBy: [{ runAt: 'desc' }, { id: 'asc' }],
          skip,
          take: PAGE_SIZE,
        }),
      ]);
    } else {
      // The post text lives in JSON, so the search is plain SQL over name and text.
      const matches = Prisma.join(
        terms.map((term) => {
          const pattern = likePattern(term);
          return Prisma.sql`(name ILIKE ${pattern} OR config->>'content' ILIKE ${pattern})`;
        }),
        ' AND ',
      );
      const where = Prisma.sql`guild_id = ${guildId}::uuid AND ${matches}`;
      const [ids, counted] = await Promise.all([
        this.prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM scheduled_tasks WHERE ${where}
            ORDER BY run_at DESC NULLS LAST, id
            LIMIT ${Prisma.raw(String(PAGE_SIZE))} OFFSET ${Prisma.raw(String(skip))}`,
        ),
        this.prisma.$queryRaw<{ total: number }[]>(
          Prisma.sql`SELECT count(*)::int AS total FROM scheduled_tasks WHERE ${where}`,
        ),
      ]);
      total = counted[0]?.total ?? 0;
      const found = await this.prisma.scheduledTask.findMany({
        where: { id: { in: ids.map((row) => row.id) } },
      });
      const byId = new Map(found.map((task) => [task.id, task]));
      tasks = ids.flatMap((row) => byId.get(row.id) ?? []);
    }
    return {
      items: tasks.map((task) => this.toDto(task, timezone)),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /** One post, for its edit page. */
  async get(taskId: string): Promise<TaskDto> {
    const task = await this.find(taskId);
    return this.toDto(task, await this.timezoneOf(task.guildId));
  }

  /** Text channels of every server of the guild, for the channel pickers. */
  async listChannels(guildId: string): Promise<ServerChannelsDto[]> {
    const servers = await this.prisma.discordServer.findMany({
      where: { guildId },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: { discordId: true, name: true },
    });
    return Promise.all(
      servers.map(async (server) => {
        try {
          return {
            serverId: server.discordId,
            serverName: server.name || server.discordId,
            channels: await this.bot.listTextChannels(server.discordId),
            error: null,
          };
        } catch (error) {
          return {
            serverId: server.discordId,
            serverName: server.name || server.discordId,
            channels: [],
            // Listing a server's channels fails with "Missing Access" when the bot isn't in it.
            error: isDiscordError(error, 50001)
              ? 'The bot is not in this server. Add it with the invite link in the setup steps (it needs the "bot" scope, not just slash commands).'
              : describeDiscordError(error),
          };
        }
      }),
    );
  }

  async create(guildId: string, userId: string, input: TaskInput): Promise<TaskDto> {
    const timezone = await this.timezoneOf(guildId);
    const now = new Date();
    const postNow = input.postNow === true;
    const runAt = postNow ? now : this.parseFutureDate(input.runAtLocal, timezone, now);
    const config = await this.parsePostConfig(guildId, input, undefined);
    const enabled = postNow || input.enabled !== false;
    const task = await this.prisma.scheduledTask.create({
      data: {
        guildId,
        type: 'POST',
        name: this.parseName(input.name, undefined),
        enabled,
        scheduleKind: 'ONCE',
        runAt,
        nextRunAt: nextRunFor({}, runAt, enabled, now),
        config: config as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    return this.toDto(task, timezone);
  }

  /**
   * Saving changes to a post that is already in Discord edits that message (live edit). If
   * Discord refuses, nothing is saved, so Discord and the backoffice never disagree. A post
   * is one message: while it is in Discord it cannot be posted again or moved to a new date.
   */
  async update(taskId: string, input: TaskInput): Promise<TaskDto> {
    const task = await this.find(taskId);
    const timezone = await this.timezoneOf(task.guildId);
    const now = new Date();
    const oldConfig = task.config as unknown as PostConfig;
    const state = task.state as PostState;
    const config = await this.parsePostConfig(task.guildId, input, oldConfig);
    const enabled = input.enabled === undefined ? task.enabled : input.enabled === true;

    let runAt = task.runAt ?? now;
    let rescheduled = false;
    if (input.postNow === true) {
      if (isLive(state)) throw new BadRequestException(ALREADY_POSTED);
      runAt = now;
      rescheduled = true;
    } else if (typeof input.runAtLocal === 'string') {
      const requested = instantFromLocal(input.runAtLocal, timezone);
      // A date that is unchanged may be in the past (it already went out); a new one may not.
      if (requested && requested.getTime() !== task.runAt?.getTime()) {
        if (isLive(state)) throw new BadRequestException(ALREADY_POSTED);
        runAt = this.parseFutureDate(input.runAtLocal, timezone, now);
        rescheduled = true;
      }
    }

    let newState = state;
    const textChanged =
      config.content !== oldConfig.content || embedsShown(config) !== embedsShown(oldConfig);
    if (textChanged && isLive(state)) {
      try {
        await this.bot.editMessage(
          state.channelId ?? oldConfig.channelId,
          state.messageId as string,
          config.content,
          { suppressEmbeds: !embedsShown(config) },
        );
      } catch (error) {
        if (isDiscordError(error, UNKNOWN_MESSAGE)) {
          newState = { ...state, messageDeleted: true };
        } else {
          throw new BadRequestException(
            `Could not update the post in Discord: ${describeDiscordError(error)}`,
          );
        }
      }
    }

    const updated = await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: {
        name: this.parseName(input.name, task.name),
        enabled,
        runAt,
        ...(rescheduled || enabled !== task.enabled
          ? { nextRunAt: nextRunFor(newState, runAt, enabled, now) }
          : {}),
        config: config as unknown as Prisma.InputJsonValue,
        state: newState as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toDto(updated, timezone);
  }

  /**
   * Deletes the message this task last posted, from Discord. The task stays (schedule, text,
   * everything), so it can be posted again later: by its schedule, "Post now", or a new date.
   */
  async deletePost(taskId: string): Promise<void> {
    const task = await this.find(taskId);
    const state = task.state as PostState;
    if (!state.messageId || !state.channelId || state.messageDeleted) {
      throw new BadRequestException('There is no post in Discord to delete.');
    }
    try {
      await this.bot.deleteMessage(state.channelId, state.messageId);
    } catch (error) {
      // Already gone from Discord counts as deleted.
      if (!isDiscordError(error, UNKNOWN_MESSAGE)) {
        throw new BadRequestException(
          `Could not delete the post in Discord: ${describeDiscordError(error)}`,
        );
      }
    }
    await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: { state: { ...state, messageDeleted: true } },
    });
  }

  /**
   * Stops tracking the task: removes it, and its history, from the backoffice and the
   * database. Whatever it posted stays in Discord and can no longer be deleted from here.
   */
  async remove(taskId: string): Promise<void> {
    await this.find(taskId);
    await this.prisma.scheduledTask.delete({ where: { id: taskId } });
  }

  /** Makes the post due now; the worker picks it up within a minute. */
  async runNow(taskId: string): Promise<void> {
    const task = await this.find(taskId);
    if (isLive(task.state as PostState)) {
      throw new BadRequestException(ALREADY_POSTED);
    }
    if (!task.enabled) {
      throw new BadRequestException('Resume the post first.');
    }
    const now = new Date();
    await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: { runAt: now, nextRunAt: now },
    });
  }

  /** Live reaction counts of the task's current post, read from Discord. */
  async reactions(taskId: string): Promise<ReactionDto[]> {
    const task = await this.find(taskId);
    const state = task.state as PostState;
    if (!state.messageId || !state.channelId || state.messageDeleted) {
      return [];
    }
    try {
      const reactions = await this.bot.getReactions(state.channelId, state.messageId);
      return reactions.map((reaction) => ({
        ...reaction,
        imageUrl: reaction.emojiId
          ? `https://cdn.discordapp.com/emojis/${reaction.emojiId}.png?size=32`
          : null,
      }));
    } catch (error) {
      if (isDiscordError(error, UNKNOWN_MESSAGE)) {
        await this.prisma.scheduledTask.update({
          where: { id: taskId },
          data: { state: { ...state, messageDeleted: true } },
        });
        return [];
      }
      throw new BadRequestException(describeDiscordError(error));
    }
  }

  /** The guild a task belongs to, for permission checks. */
  async guildIdOf(taskId: string): Promise<string> {
    return (await this.find(taskId)).guildId;
  }

  toDto(task: ScheduledTask, timezone: string): TaskDto {
    const config = task.config as unknown as PostConfig;
    const state = task.state as PostState;
    return {
      id: task.id,
      name: task.name,
      type: 'POST',
      enabled: task.enabled,
      schedule: {
        runAt: task.runAt?.toISOString() ?? null,
        runAtLocal: task.runAt ? localWallClock(task.runAt, timezone) : null,
        description: describeSchedule({ kind: 'ONCE', runAt: task.runAt }, timezone),
      },
      timezone,
      nextRunAt: task.nextRunAt?.toISOString() ?? null,
      lastRunAt: task.lastRunAt?.toISOString() ?? null,
      lastStatus: task.lastStatus,
      lastError: task.lastError,
      post: {
        serverId: config.serverId,
        channelId: config.channelId,
        content: config.content,
        seedReactions: config.seedReactions,
        embedLinks: embedsShown(config),
        posted:
          state.messageId && state.channelId
            ? {
                messageId: state.messageId,
                url: messageUrl(
                  state.serverId ?? config.serverId,
                  state.channelId,
                  state.messageId,
                ),
                postedAt: state.postedAt ?? '',
                messageDeleted: state.messageDeleted === true,
              }
            : null,
      },
    };
  }

  private async find(taskId: string): Promise<ScheduledTask> {
    const task = await this.prisma.scheduledTask.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private async timezoneOf(guildId: string): Promise<string> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { region: true },
    });
    return timezoneOfRegion(guild?.region ?? DEFAULT_REGION);
  }

  private parseName(value: unknown, fallback: string | undefined): string {
    if (value === undefined && fallback !== undefined) return fallback;
    const name = typeof value === 'string' ? value.trim() : '';
    if (name === '' || name.length > 80) {
      throw new BadRequestException('Give the task a name (up to 80 characters).');
    }
    return name;
  }

  /** A date and time in the future, read as wall-clock time in the guild's timezone. */
  private parseFutureDate(value: unknown, timezone: string, now: Date): Date {
    const runAt = typeof value === 'string' ? instantFromLocal(value, timezone) : null;
    if (!runAt) {
      throw new BadRequestException('Pick the date and time to post.');
    }
    if (runAt.getTime() <= now.getTime()) {
      throw new BadRequestException('Pick a date and time in the future.');
    }
    return runAt;
  }

  /** Validates the post fields, and that the channel really belongs to one of the guild's servers. */
  private async parsePostConfig(
    guildId: string,
    input: TaskInput,
    existing: PostConfig | undefined,
  ): Promise<PostConfig> {
    const serverId =
      input.serverId === undefined && existing
        ? existing.serverId
        : parseSnowflake(input.serverId, 'The server');
    const channelId =
      input.channelId === undefined && existing
        ? existing.channelId
        : parseSnowflake(input.channelId, 'The channel');
    const content =
      input.content === undefined && existing ? existing.content : parsePostContent(input.content);
    const seedReactions =
      input.seedReactions === undefined && existing
        ? existing.seedReactions
        : parseSeedReactions(input.seedReactions);

    const changedChannel =
      !existing || serverId !== existing.serverId || channelId !== existing.channelId;
    if (changedChannel) {
      const server = await this.prisma.discordServer.findFirst({
        where: { guildId, discordId: serverId },
        select: { id: true },
      });
      if (!server) {
        throw new BadRequestException('That server is not part of this guild.');
      }
      let channels: ServerChannel[];
      try {
        channels = await this.bot.listTextChannels(serverId);
      } catch (error) {
        throw new BadRequestException(
          `Could not read the server's channels: ${describeDiscordError(error)}`,
        );
      }
      if (!channels.some((channel) => channel.id === channelId)) {
        throw new BadRequestException('That channel is not in the chosen server.');
      }
    }
    const embedLinks = parseEmbedLinks(input.embedLinks, existing ? embedsShown(existing) : true);
    return { serverId, channelId, content, seedReactions, embedLinks };
  }
}

/** "yyyy-MM-ddTHH:mm" of an instant in the timezone, for datetime-local inputs. */
function localWallClock(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  return parts.replace(' ', 'T');
}
