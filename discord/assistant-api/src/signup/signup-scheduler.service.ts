import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SignupEventsService } from './signup-events.service';

const TICK_MS = 60 * 1000;
/** Uploaded assignment images no assignment kept are removed after this long. */
const ORPHAN_IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The sign-up feature's part of the background worker, once a minute: shows events that have
 * started as closed on Discord (the buttons stop working on their own; this updates the post to
 * say so) and removes abandoned image uploads. (Plugin runs would go here: see plugins.ts.)
 */
@Injectable()
export class SignupSchedulerService implements OnApplicationShutdown {
  private readonly logger = new Logger(SignupSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: SignupEventsService,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Never throws. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const started = await this.prisma.signupEvent.findMany({
        where: { lockMode: 'AUTO', closedShown: false, archivedAt: null, startsAt: { lte: now } },
        select: { id: true },
        take: 50,
      });
      for (const { id } of started) {
        // Claimed by flipping the flag, so two workers never both do it.
        const { count } = await this.prisma.signupEvent.updateMany({
          where: { id, closedShown: false },
          data: { closedShown: true },
        });
        if (count === 0) continue;
        this.events.refresh(id);
        await this.events.settled(id);
      }
      await this.prisma.signupImage.deleteMany({
        where: {
          assignmentId: null,
          createdAt: { lt: new Date(now.getTime() - ORPHAN_IMAGE_MAX_AGE_MS) },
        },
      });
    } catch (error) {
      this.logger.error(`Sign-up tick failed: ${String(error)}`);
    } finally {
      this.ticking = false;
    }
  }
}
