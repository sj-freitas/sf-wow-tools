import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, ScheduledTask } from '@prisma/client';
import { DEFAULT_REGION, timezoneOfRegion } from '../config/regions';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError } from '../discord/discord-errors';
import type { PostConfig, PostState } from './post-task';
import { nextOccurrence, occurrencesBetween, type Schedule } from './schedule';

/** A failed run is retried this many times in total (within RETRY_WINDOW_MS) before moving on. */
export const MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 5 * 60 * 1000;
const RETRY_WINDOW_MS = 30 * 60 * 1000;

/**
 * Executes one due task: does the work, records the run, and decides when it runs next.
 * Missed occurrences are never dropped: whoever finds a task overdue runs it, late rather
 * than never. A recurring task catches up with a single run; the occurrences it skipped
 * are recorded as MISSED so nothing is silently lost.
 */
@Injectable()
export class TaskRunnerService {
  private readonly logger = new Logger(TaskRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  async run(task: ScheduledTask, now: Date = new Date()): Promise<void> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: task.guildId },
      select: { region: true },
    });
    const timezone = timezoneOfRegion(guild?.region ?? DEFAULT_REGION);
    const schedule: Schedule = {
      kind: task.scheduleKind,
      runAt: task.runAt,
      timeOfDay: task.timeOfDay,
      weekday: task.weekday,
    };
    const scheduledFor = task.nextRunAt ?? now;

    let state = task.state as PostState;
    let error: string | null = null;
    try {
      state = await this.execute(task);
    } catch (caught) {
      error = describeDiscordError(caught);
      this.logger.warn(`Task ${task.id} (${task.name}) failed: ${String(caught)}`);
    }

    await this.prisma.taskRun.upsert({
      where: { taskId_scheduledFor: { taskId: task.id, scheduledFor } },
      create: {
        taskId: task.id,
        scheduledFor,
        finishedAt: new Date(),
        status: error ? 'FAILED' : 'SUCCESS',
        error,
      },
      update: { finishedAt: new Date(), status: error ? 'FAILED' : 'SUCCESS', error },
    });

    if (schedule.kind !== 'ONCE') {
      const missed = occurrencesBetween(schedule, timezone, scheduledFor, now);
      if (missed.length > 0) {
        await this.prisma.taskRun.createMany({
          data: missed.map((occurrence) => ({
            taskId: task.id,
            scheduledFor: occurrence,
            finishedAt: now,
            status: 'MISSED' as const,
            error: 'Skipped while catching up after a delay.',
          })),
          skipDuplicates: true,
        });
      }
    }

    const retry = error !== null && (await this.shouldRetry(task.id, now));
    await this.prisma.scheduledTask.update({
      where: { id: task.id },
      data: {
        lastRunAt: now,
        lastStatus: error ? 'FAILED' : 'SUCCESS',
        lastError: error,
        nextRunAt: retry
          ? new Date(now.getTime() + RETRY_DELAY_MS)
          : nextOccurrence(schedule, timezone, now),
        leaseUntil: null,
        state: state as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async execute(task: ScheduledTask): Promise<PostState> {
    // POST is the only task type so far. A post is one message: never send a second one.
    const previous = task.state as PostState;
    if (previous.messageId && !previous.messageDeleted) {
      throw new Error('This post is already in Discord. Delete it first to post it again.');
    }
    const config = task.config as unknown as PostConfig;
    const messageId = await this.bot.postMessage(config.channelId, config.content);
    const state: PostState = {
      messageId,
      channelId: config.channelId,
      serverId: config.serverId,
      postedAt: new Date().toISOString(),
    };
    for (const emoji of config.seedReactions) {
      try {
        await this.bot.addReaction(config.channelId, messageId, emoji);
      } catch (error) {
        // The post is out; a missing seed reaction is not worth failing (and re-posting) for.
        this.logger.warn(`Could not add reaction ${emoji} to ${messageId}: ${String(error)}`);
      }
    }
    return state;
  }

  private async shouldRetry(taskId: string, now: Date): Promise<boolean> {
    const failures = await this.prisma.taskRun.count({
      where: {
        taskId,
        status: 'FAILED',
        finishedAt: { gte: new Date(now.getTime() - RETRY_WINDOW_MS) },
      },
    });
    return failures < MAX_ATTEMPTS;
  }
}
