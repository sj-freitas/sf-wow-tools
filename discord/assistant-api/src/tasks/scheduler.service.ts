import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TaskRunnerService } from './task-runner.service';
import { TrackingService } from './tracking.service';

const TICK_MS = 60 * 1000;
const LEASE_MINUTES = 5;
const BATCH_SIZE = 10;

/**
 * Wakes up every minute, runs whatever is due and refreshes the posts that show live reactions. Due tasks are claimed in the database
 * (`FOR UPDATE SKIP LOCKED` plus a lease), so several workers can run side by side without
 * doing anything twice. The first tick happens at start-up, which also picks up everything
 * that came due while no worker was running.
 */
@Injectable()
export class SchedulerService implements OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: TaskRunnerService,
    private readonly tracking: TrackingService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.logger.log(`Scheduler started (every ${TICK_MS / 1000}s)`);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass: claim due tasks and run them. Never throws. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let ran = 0;
    try {
      for (;;) {
        const claimed = await this.claimDue();
        if (claimed.length === 0) break;
        for (const id of claimed) {
          const task = await this.prisma.scheduledTask.findUnique({ where: { id } });
          if (!task) continue;
          try {
            await this.runner.run(task);
            ran++;
          } catch (error) {
            this.logger.error(`Running task ${id} failed: ${String(error)}`);
          }
        }
        if (claimed.length < BATCH_SIZE) break;
      }
      // Posts whose text shows who reacted are brought up to date once a minute.
      await this.tracking.refreshDue();
    } catch (error) {
      this.logger.error(`Scheduler tick failed: ${String(error)}`);
    } finally {
      this.ticking = false;
    }
    return ran;
  }

  private async claimDue(): Promise<string[]> {
    // The two numbers are our own constants, inlined so Postgres sees plain literals.
    const lease = Prisma.raw(`interval '${LEASE_MINUTES} minutes'`);
    const batch = Prisma.raw(String(BATCH_SIZE));
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE scheduled_tasks
      SET lease_until = now() + ${lease}
      WHERE id IN (
        SELECT id FROM scheduled_tasks
        WHERE enabled
          AND next_run_at IS NOT NULL
          AND next_run_at <= now()
          AND (lease_until IS NULL OR lease_until < now())
        ORDER BY next_run_at
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    return rows.map((row) => row.id);
  }
}
