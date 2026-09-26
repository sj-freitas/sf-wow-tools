import { randomUUID } from 'node:crypto';
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
  isComplete,
  isLive,
  liveMessageOf,
  liveMessages,
  messageUrl,
  normalizeEmoji,
  parseParts,
  parseSnowflake,
  wasDeleted,
  type PostConfig,
  type PostedPart,
  type PostPart,
  type PostState,
} from './post-task';
import { PostImagesService } from './post-images.service';
import {
  checkExpressions,
  parseAllTokens,
  parseDynamicTokens,
  renderContent,
  type Reactor,
} from './dynamic-content';
import { TrackingService } from './tracking.service';
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
    /** The messages of the post, in the order they are sent. */
    parts: PostPartDto[];
    /** Some message of the post is in Discord. */
    live: boolean;
    /** Every message of the post is in Discord. */
    complete: boolean;
    /** It was in Discord and every message was deleted. */
    wasDeleted: boolean;
  };
}

/** One message of a post. */
export interface PostPartDto {
  id: string;
  content: string;
  seedReactions: string[];
  /** Whether Discord shows link previews under the message. */
  embedLinks: boolean;
  /** Seconds waited after the previous message before this one is sent. */
  delaySeconds: number;
  /** Uploaded images (see the post-images routes), shown under the text. */
  imageIds: string[];
  /** The message in Discord; null when it is not there. */
  posted: { messageId: string; url: string; postedAt: string } | null;
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
  /** The messages of the post: `[{ id?, content, seedReactions?, embedLinks?, delaySeconds?, imageIds? }]`. */
  parts?: unknown;
}

export interface ReactionDto extends MessageReaction {
  /** Image of a custom emoji. */
  imageUrl: string | null;
}

const ALREADY_POSTED =
  'This post is already in Discord. Edit it there, or delete it first to post it again.';

/**
 * When the worker should post next. A post goes out once: never while it is complete or paused,
 * and after it was deleted only at a new future date. One that never went out and whose time has
 * passed goes out now, late rather than never; so does one that stopped halfway (some messages
 * sent), which continues with the rest.
 */
function nextRunFor(
  config: PostConfig,
  state: PostState,
  runAt: Date,
  enabled: boolean,
  now: Date,
): Date | null {
  if (!enabled || isComplete(config, state)) return null;
  const future = runAt.getTime() > now.getTime();
  if (isLive(state)) return future ? runAt : now; // halfway: finish the rest
  if (wasDeleted(state)) return future ? runAt : null;
  return future ? runAt : now;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
    private readonly tracking: TrackingService,
    private readonly images: PostImagesService,
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
          return Prisma.sql`(name ILIKE ${pattern} OR EXISTS (SELECT 1 FROM jsonb_array_elements(config->'parts') AS part WHERE part->>'content' ILIKE ${pattern}))`;
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
    const tokens = parseAllTokens(config.parts);
    await checkExpressions(tokens);
    await this.tracking.resolveSources(guildId, tokens);
    await this.images.assertUsable(guildId, undefined, imageIdsOf(config));
    const enabled = postNow || input.enabled !== false;
    const task = await this.prisma.scheduledTask.create({
      data: {
        guildId,
        type: 'POST',
        name: this.parseName(input.name, undefined),
        enabled,
        scheduleKind: 'ONCE',
        runAt,
        nextRunAt: nextRunFor(config, {}, runAt, enabled, now),
        config: config as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    await this.images.attach(task.id, config);
    await this.tracking.syncTracking(
      task.id,
      tokens,
      await this.tracking.resolveSources(guildId, tokens, task.id),
    );
    return this.toDto(task, timezone);
  }

  /**
   * Saving changes to a post edits the messages that are already in Discord (live edit): text,
   * images and link previews of each one. If Discord refuses, the change is not saved, so Discord
   * and the backoffice do not disagree. What is in Discord keeps its order: messages that are up
   * cannot be moved, only edited or removed, and no message can be added to a post that is in
   * Discord. Messages not sent yet can be changed freely.
   */
  async update(taskId: string, input: TaskInput): Promise<TaskDto> {
    const task = await this.find(taskId);
    const timezone = await this.timezoneOf(task.guildId);
    const now = new Date();
    const oldConfig = task.config as unknown as PostConfig;
    const state = task.state as PostState;
    const config = await this.parsePostConfig(task.guildId, input, oldConfig);
    if (
      isLive(state) &&
      (config.serverId !== oldConfig.serverId || config.channelId !== oldConfig.channelId)
    ) {
      throw new BadRequestException(
        'This post is in Discord: delete it first to move it to another channel.',
      );
    }
    if (isLive(state)) {
      const known = new Set(oldConfig.parts.map((part) => part.id));
      if (config.parts.some((part) => !known.has(part.id))) {
        throw new BadRequestException(
          'Messages cannot be added to a post that is already in Discord. Delete the post first, then add them.',
        );
      }
    }
    this.assertOrderKept(oldConfig, config, state);
    const tokens = parseAllTokens(config.parts);
    await checkExpressions(tokens);
    const sources = await this.tracking.resolveSources(task.guildId, tokens, taskId);
    await this.images.assertUsable(task.guildId, taskId, imageIdsOf(config));
    const enabled = input.enabled === undefined ? task.enabled : input.enabled === true;

    let runAt = task.runAt ?? now;
    let rescheduled = false;
    if (input.postNow === true) {
      if (isComplete(oldConfig, state)) throw new BadRequestException(ALREADY_POSTED);
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

    const edit = await this.editLiveMessages(task, oldConfig, config, state, sources);
    const newState = edit.state;
    if (edit.failure) {
      await this.saveState(taskId, newState);
      throw edit.failure;
    }
    const updated = await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: {
        name: this.parseName(input.name, task.name),
        enabled,
        runAt,
        ...(rescheduled || enabled !== task.enabled
          ? { nextRunAt: nextRunFor(config, newState, runAt, enabled, now) }
          : {}),
        config: config as unknown as Prisma.InputJsonValue,
        state: newState as unknown as Prisma.InputJsonValue,
      },
    });
    await this.images.attach(taskId, config);
    await this.tracking.syncTracking(taskId, tokens, sources, edit.people);
    return this.toDto(updated, timezone);
  }

  /**
   * The messages already in Discord keep their order: the ones still in the post must be in the
   * order they were sent, and come before every message that is not in Discord yet.
   */
  private assertOrderKept(oldConfig: PostConfig, config: PostConfig, state: PostState): void {
    const up = new Set(liveMessages(state).map((message) => message.partId));
    const kept = new Set(config.parts.map((part) => part.id));
    // Messages taken out of the post do not count: only the ones that stay must keep their order.
    const before = oldConfig.parts
      .filter((part) => up.has(part.id) && kept.has(part.id))
      .map((part) => part.id);
    const after = config.parts.filter((part) => up.has(part.id)).map((part) => part.id);
    if (after.join() !== before.join()) {
      throw new BadRequestException(
        'The messages already in Discord keep their order. Delete the post to change it.',
      );
    }
    let seenNew = false;
    for (const part of config.parts) {
      if (!up.has(part.id)) seenNew = true;
      else if (seenNew) {
        throw new BadRequestException(
          'Messages already in Discord come before the ones not sent yet. Delete the post to change the order.',
        );
      }
    }
  }

  /**
   * Brings the messages that are in Discord in line with the saved parts: edits the ones whose
   * text, images or link previews changed, and deletes the ones taken out of the post. Stops at
   * the first Discord refusal, returning what was done so far.
   */
  private async editLiveMessages(
    task: ScheduledTask,
    oldConfig: PostConfig,
    config: PostConfig,
    state: PostState,
    sources: Awaited<ReturnType<TrackingService['resolveSources']>>,
  ): Promise<{
    state: PostState;
    people?: Awaited<ReturnType<TrackingService['fetchPeople']>>;
    failure?: BadRequestException;
  }> {
    let messages: PostedPart[] = state.messages ?? [];
    let people: Awaited<ReturnType<TrackingService['fetchPeople']>> | undefined;
    const done = () => ({ state: { messages } as PostState, people });
    const remaining = new Set(config.parts.map((part) => part.id));

    // Messages of parts that were taken out of the post.
    for (const posted of liveMessages(state)) {
      if (remaining.has(posted.partId)) continue;
      try {
        await this.bot.deleteMessage(posted.channelId, posted.messageId);
      } catch (error) {
        if (!isDiscordError(error, UNKNOWN_MESSAGE)) {
          return {
            ...done(),
            failure: new BadRequestException(
              `Could not delete the message in Discord: ${describeDiscordError(error)}`,
            ),
          };
        }
      }
      messages = messages.filter((message) => message !== posted);
    }
    // Entries of parts that are gone and were already deleted are dropped too.
    messages = messages.filter((message) => remaining.has(message.partId));

    for (const [index, part] of config.parts.entries()) {
      const posted = liveMessageOf({ messages }, part.id);
      if (!posted) continue;
      const old = oldConfig.parts.find((candidate) => candidate.id === part.id);
      const imagesChanged = part.imageIds.join() !== posted.imageIds.join();
      const changed =
        old?.content !== part.content || part.embedLinks !== posted.embedLinks || imagesChanged;
      if (!changed) continue;

      const tokens = parseDynamicTokens(part.content, index + 1);
      let rendered = part.content;
      if (tokens.length > 0) {
        try {
          const fetched = await this.tracking.fetchPeople(task.guildId, tokens, sources);
          people = new Map([...(people ?? []), ...fetched]);
          rendered = await renderContent(part.content, tokens, fetched);
        } catch (error) {
          return {
            ...done(),
            failure: new BadRequestException(
              `Could not read the reactions from Discord: ${describeDiscordError(error)}`,
            ),
          };
        }
      }
      try {
        await this.bot.editMessage(posted.channelId, posted.messageId, rendered, {
          suppressEmbeds: !part.embedLinks,
          // Edits that show people never ping them.
          ...(tokens.length > 0 ? { quiet: true } : {}),
          ...(imagesChanged ? { files: await this.images.files(part.imageIds) } : {}),
        });
        messages = messages.map((message) =>
          message === posted
            ? {
                ...message,
                renderedContent: rendered,
                embedLinks: part.embedLinks,
                imageIds: part.imageIds,
              }
            : message,
        );
      } catch (error) {
        if (isDiscordError(error, UNKNOWN_MESSAGE)) {
          messages = messages.map((message) =>
            message === posted ? { ...message, deleted: true } : message,
          );
        } else {
          return {
            ...done(),
            failure: new BadRequestException(
              `Could not update the post in Discord: ${describeDiscordError(error)}`,
            ),
          };
        }
      }
    }
    return done();
  }

  private async saveState(taskId: string, state: PostState): Promise<void> {
    await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: { state: state as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Deletes the messages this post has in Discord. The post stays (schedule, text, images,
   * everything), so it can be posted again later: by its schedule, "Post now", or a new date.
   */
  async deletePost(taskId: string): Promise<void> {
    const task = await this.find(taskId);
    const state = task.state as PostState;
    const live = liveMessages(state);
    if (live.length === 0) {
      throw new BadRequestException('There is no post in Discord to delete.');
    }
    let messages = state.messages ?? [];
    for (const posted of live) {
      try {
        await this.bot.deleteMessage(posted.channelId, posted.messageId);
      } catch (error) {
        // Already gone from Discord counts as deleted.
        if (!isDiscordError(error, UNKNOWN_MESSAGE)) {
          await this.saveState(taskId, { messages });
          throw new BadRequestException(
            `Could not delete the post in Discord: ${describeDiscordError(error)}`,
          );
        }
      }
      messages = messages.map((message) =>
        message === posted ? { ...message, deleted: true } : message,
      );
    }
    await this.saveState(taskId, { messages });
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
    if (isComplete(task.config as unknown as PostConfig, task.state as PostState)) {
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

  /** Live reaction counts of one message of the post (`part` from 1), read from Discord. */
  async reactions(taskId: string, part = 1): Promise<ReactionDto[]> {
    const task = await this.find(taskId);
    const state = task.state as PostState;
    const target = (task.config as unknown as PostConfig).parts[part - 1];
    const posted = target ? liveMessageOf(state, target.id) : undefined;
    if (!posted) return [];
    try {
      const reactions = await this.bot.getReactions(posted.channelId, posted.messageId);
      return reactions.map((reaction) => ({
        ...reaction,
        imageUrl: reaction.emojiId
          ? `https://cdn.discordapp.com/emojis/${reaction.emojiId}.png?size=32`
          : null,
      }));
    } catch (error) {
      if (isDiscordError(error, UNKNOWN_MESSAGE)) {
        await this.saveState(taskId, {
          messages: (state.messages ?? []).map((message) =>
            message === posted ? { ...message, deleted: true } : message,
          ),
        });
        return [];
      }
      throw new BadRequestException(describeDiscordError(error));
    }
  }

  /** Who reacted to one message of the post with an emoji: the names behind a reaction's count. */
  async reactionUsers(taskId: string, emoji: unknown, part = 1): Promise<Reactor[]> {
    const task = await this.find(taskId);
    const normalized = typeof emoji === 'string' ? normalizeEmoji(emoji) : null;
    if (!normalized) throw new BadRequestException('Say which emoji (custom ones as name:id).');
    try {
      return await this.tracking.readReactors(this.tracking.locationOfTask(task, part), normalized);
    } catch (error) {
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
        parts: config.parts.map((part): PostPartDto => {
          const posted = liveMessageOf(state, part.id);
          return {
            id: part.id,
            content: part.content,
            seedReactions: part.seedReactions,
            embedLinks: part.embedLinks,
            delaySeconds: part.delaySeconds,
            imageIds: part.imageIds,
            posted: posted
              ? {
                  messageId: posted.messageId,
                  url: messageUrl(posted.serverId, posted.channelId, posted.messageId),
                  postedAt: posted.postedAt,
                }
              : null,
          };
        }),
        live: isLive(state),
        complete: isComplete(config, state),
        wasDeleted: wasDeleted(state),
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
    const parts: PostPart[] =
      input.parts === undefined && existing ? existing.parts : parseParts(input.parts, randomUUID);

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
    return { serverId, channelId, parts };
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

/** Every image id the parts of a post use. */
const imageIdsOf = (config: PostConfig): string[] => config.parts.flatMap((part) => part.imageIds);
