import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { HoneypotGatewayService } from '../honeypot/honeypot-gateway.service';
import { RetentionService } from '../maintenance/retention.service';
import { PluginRunnerService } from '../plugins/plugin-runner.service';
import { SignupEventsService } from '../signup/signup-events.service';
import { SignupSchedulerService } from '../signup/signup-scheduler.service';
import { SchedulerService } from '../tasks/scheduler.service';

/**
 * The background worker: the scheduler for scheduled tasks, the plugins' runs and the live
 * Discord connection for honeypots. Runs in its own process (`worker.ts`) or, on a single instance, inside the
 * web process (`WORKER_IN_PROCESS=true`). Officers never see any of this.
 */
@Injectable()
export class WorkerService implements OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly honeypotGateway: HoneypotGatewayService,
    private readonly signupScheduler: SignupSchedulerService,
    private readonly signupEvents: SignupEventsService,
    private readonly plugins: PluginRunnerService,
    private readonly retention: RetentionService,
  ) {}

  async start(): Promise<void> {
    this.scheduler.start();
    this.signupScheduler.start();
    this.plugins.start();
    // History older than 6 months, once a day.
    this.retention.start();
    // An event whose sign-up post is deleted in Discord is archived.
    this.honeypotGateway.onMessageDeleted((messageId) => {
      void this.signupEvents.onMessageDeleted(messageId);
    });
    try {
      await this.honeypotGateway.start();
    } catch (error) {
      // The scheduler keeps working; honeypots are inactive until the connection works.
      this.logger.error(`Could not start the honeypot listener: ${String(error)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.honeypotGateway.stop();
  }
}
