import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { HoneypotGatewayService } from '../honeypot/honeypot-gateway.service';
import { SchedulerService } from '../tasks/scheduler.service';

/**
 * The background worker: the scheduler for scheduled tasks and the live Discord connection
 * for honeypots. Runs in its own process (`worker.ts`) or, on a single instance, inside the
 * web process (`WORKER_IN_PROCESS=true`). Officers never see any of this.
 */
@Injectable()
export class WorkerService implements OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly honeypotGateway: HoneypotGatewayService,
  ) {}

  async start(): Promise<void> {
    this.scheduler.start();
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
