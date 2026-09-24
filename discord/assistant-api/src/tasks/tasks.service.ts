import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ScheduledTask, ScheduleKind, TaskRunStatus } from '@prisma/client';
import { DEFAULT_REGION, timezoneOfRegion } from '../config/regions';
import { PrismaService } from '../database/prisma.service';
import { describeDiscordError, isDiscordError, UNKNOWN_MESSAGE } from '../discord/discord-errors';
import {
  DiscordBotService,
  type MessageReaction,
  type ServerChannel,
} from '../discord/discord-bot.service';
import {
  messageUrl,
  parsePostContent,
  parseSeedReactions,
  parseSnowflake,
  type PostConfig,
  type PostState,
} from './post-task';
import {
  describeSchedule,
  instantFromLocal,
  nextOccurrence,
  validateSchedule,
  type Schedule,
} from './schedule';

export interface TaskDto {
  id: string;
  name: string;
  type: 'POST';
  enabled: boolean;
  schedule: {
    kind: ScheduleKind;
    /** ONCE: the instant, ISO. */
    runAt: string | null;
    /** ONCE: the same instant as wall-clock "yyyy-MM-ddTHH:mm" in the guild's timezone. */
    runAtLocal: string | null;
    timeOfDay: string | null;
    weekday: number | null;
    description: string;
  };
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: TaskRunStatus | null;
  lastError: string | null;
  post: {
    serverId: string;
    channelId: string;
    content: string;
    seedReactions: string[];
    posted: { messageId: string; url: string; postedAt: string; messageDeleted: boolean } | null;
  };
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
  kind?: unknown;
  runAtLocal?: unknown;
  timeOfDay?: unknown;
  weekday?: unknown;
  serverId?: unknown;
  channelId?: unknown;
  content?: unknown;
  seedReactions?: unknown;
}

export interface ReactionDto extends MessageReaction {
  /** Image of a custom emoji. */
  imageUrl: string | null;
}

const KINDS: readonly ScheduleKind[] = ['ONCE', 'DAILY', 'WEEKLY'];

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  async list(guildId: string): Promise<TaskDto[]> {
    const timezone = await this.timezoneOf(guildId);
    const tasks = await this.prisma.scheduledTask.findMany({
      where: { guildId },
      orderBy: { createdAt: 'asc' },
    });
    return tasks.map((task) => this.toDto(task, timezone));
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
    const schedule = this.parseSchedule(input, timezone, undefined);
    const config = await this.parsePostConfig(guildId, input, undefined);
    const enabled = input.enabled === undefined ? true : input.enabled === true;
    const task = await this.prisma.scheduledTask.create({
      data: {
        guildId,
        type: 'POST',
        name: this.parseName(input.name, undefined),
        enabled,
        scheduleKind: schedule.kind,
        runAt: schedule.runAt ?? null,
        timeOfDay: schedule.timeOfDay ?? null,
        weekday: schedule.weekday ?? null,
        nextRunAt: enabled ? nextOccurrence(schedule, timezone, new Date()) : null,
        config: config as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    return this.toDto(task, timezone);
  }

  /**
   * Saving changes to a post that is already in Discord edits that message (live edit). If
   * Discord refuses, nothing is saved, so Discord and the backoffice never disagree.
   */
  async update(taskId: string, input: TaskInput): Promise<TaskDto> {
    const task = await this.find(taskId);
    const timezone = await this.timezoneOf(task.guildId);
    const oldConfig = task.config as unknown as PostConfig;
    const state = task.state as PostState;

    const schedule = this.parseSchedule(input, timezone, task);
    const config = await this.parsePostConfig(task.guildId, input, oldConfig);
    const scheduleChanged =
      input.kind !== undefined ||
      input.runAtLocal !== undefined ||
      input.timeOfDay !== undefined ||
      input.weekday !== undefined;
    const enabled = input.enabled === undefined ? task.enabled : input.enabled === true;

    let newState = state;
    if (config.content !== oldConfig.content && state.messageId && !state.messageDeleted) {
      try {
        await this.bot.editMessage(
          state.channelId ?? oldConfig.channelId,
          state.messageId,
          config.content,
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

    const reschedule = scheduleChanged || (enabled && !task.enabled);
    const updated = await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: {
        name: this.parseName(input.name, task.name),
        enabled,
        scheduleKind: schedule.kind,
        runAt: schedule.runAt ?? null,
        timeOfDay: schedule.timeOfDay ?? null,
        weekday: schedule.weekday ?? null,
        ...(reschedule || !enabled
          ? { nextRunAt: enabled ? nextOccurrence(schedule, timezone, new Date()) : null }
          : {}),
        config: config as unknown as Prisma.InputJsonValue,
        state: newState as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toDto(updated, timezone);
  }

  async remove(taskId: string): Promise<void> {
    await this.find(taskId);
    await this.prisma.scheduledTask.delete({ where: { id: taskId } });
  }

  /** Makes the task due now; the worker picks it up within a minute. */
  async runNow(taskId: string): Promise<void> {
    const task = await this.find(taskId);
    if (!task.enabled) {
      throw new BadRequestException('Enable the task first.');
    }
    await this.prisma.scheduledTask.update({
      where: { id: taskId },
      data: { nextRunAt: new Date() },
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
    const schedule = this.scheduleOf(task);
    return {
      id: task.id,
      name: task.name,
      type: 'POST',
      enabled: task.enabled,
      schedule: {
        kind: task.scheduleKind,
        runAt: task.runAt?.toISOString() ?? null,
        runAtLocal: task.runAt ? localWallClock(task.runAt, timezone) : null,
        timeOfDay: task.timeOfDay,
        weekday: task.weekday,
        description: describeSchedule(schedule, timezone),
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

  scheduleOf(task: ScheduledTask): Schedule {
    return {
      kind: task.scheduleKind,
      runAt: task.runAt,
      timeOfDay: task.timeOfDay,
      weekday: task.weekday,
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

  /** The schedule from the input, falling back to the existing task's values when editing. */
  private parseSchedule(
    input: TaskInput,
    timezone: string,
    existing: ScheduledTask | undefined,
  ): Schedule {
    const kind = (input.kind ?? existing?.scheduleKind) as ScheduleKind;
    if (!KINDS.includes(kind)) {
      throw new BadRequestException('Choose once, daily or weekly.');
    }
    const schedule: Schedule = { kind };
    if (kind === 'ONCE') {
      schedule.runAt =
        input.runAtLocal === undefined
          ? existing?.runAt
          : typeof input.runAtLocal === 'string'
            ? instantFromLocal(input.runAtLocal, timezone)
            : null;
      if (
        input.runAtLocal !== undefined &&
        schedule.runAt &&
        schedule.runAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException('Pick a date and time in the future.');
      }
    } else {
      schedule.timeOfDay =
        typeof input.timeOfDay === 'string' ? input.timeOfDay : (existing?.timeOfDay ?? null);
      if (kind === 'WEEKLY') {
        schedule.weekday =
          typeof input.weekday === 'number' ? input.weekday : (existing?.weekday ?? null);
      }
    }
    const problems = validateSchedule(schedule);
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(' '));
    }
    return schedule;
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
    return { serverId, channelId, content, seedReactions };
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
