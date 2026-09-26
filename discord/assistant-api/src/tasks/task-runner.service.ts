import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, ScheduledTask } from '@prisma/client';
import { DEFAULT_REGION, timezoneOfRegion } from '../config/regions';
import { PrismaService } from '../database/prisma.service';
import { describeDiscordError } from '../discord/discord-errors';
import { PostSenderService } from './post-sender.service';
import { isComplete, type PostConfig, type PostState } from './post-task';
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
    private readonly sender: PostSenderService,
  ) {}

  /** How the worker waits between the messages of a post (replaced in tests). */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    // Kept up to date while the messages go out, so a failure halfway keeps what was sent.
    const progress = { state: task.state as PostState };
    let error: string | null = null;
    try {
      progress.state = await this.execute(task, progress);
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
        state: progress.state as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async execute(task: ScheduledTask, progress: { state: PostState }): Promise<PostState> {
    // POST is the only task type so far. A message is sent once: never send a second copy.
    const config = task.config as unknown as PostConfig;
    if (isComplete(config, progress.state)) {
      throw new Error('This post is already in Discord. Delete it first to post it again.');
    }
    return this.sender.sendMissing(task, config, progress.state, {
      wait: (seconds) => this.sleep(seconds * 1000),
      onSent: async (state) => {
        progress.state = state;
        await this.prisma.scheduledTask.update({
          where: { id: task.id },
          data: { state: state as unknown as Prisma.InputJsonValue },
        });
      },
    });
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
