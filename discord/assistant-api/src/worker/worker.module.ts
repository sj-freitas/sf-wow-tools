import { Module } from '@nestjs/common';
import { HoneypotCoreModule } from '../honeypot/honeypot-core.module';
import { TasksCoreModule } from '../tasks/tasks-core.module';
import { WorkerService } from './worker.service';

@Module({
  imports: [TasksCoreModule, HoneypotCoreModule],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
