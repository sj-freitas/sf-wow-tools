import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../database/prisma.service';

/** History older than this is deleted. */
export const RETENTION_MONTHS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes old history once a day (and when the worker starts): the runs of scheduled posts and
 * plugins, and what honeypots did. Only history: posts, plugins, honeypots and events themselves
 * are never touched.
 */
@Injectable()
export class RetentionService implements OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  start(): void {
    if (this.timer) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), DAY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass; returns how many rows went. Never throws. */
  async run(now: Date = new Date()): Promise<number> {
    const before = DateTime.fromJSDate(now).minus({ months: RETENTION_MONTHS }).toJSDate();
    try {
      const [taskRuns, pluginRuns, honeypotEvents] = await this.prisma.$transaction([
        this.prisma.taskRun.deleteMany({ where: { scheduledFor: { lt: before } } }),
        this.prisma.pluginRun.deleteMany({ where: { startedAt: { lt: before } } }),
        this.prisma.honeypotEvent.deleteMany({ where: { createdAt: { lt: before } } }),
      ]);
      const total = taskRuns.count + pluginRuns.count + honeypotEvents.count;
      if (total > 0) {
        this.logger.log(
          `Deleted history older than ${RETENTION_MONTHS} months: ${taskRuns.count} post runs, ${pluginRuns.count} plugin runs, ${honeypotEvents.count} honeypot events`,
        );
      }
      return total;
    } catch (error) {
      this.logger.error(`Deleting old history failed: ${String(error)}`);
      return 0;
    }
  }
}
