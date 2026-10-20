import { Module } from '@nestjs/common';
import { HoneypotCoreModule } from '../honeypot/honeypot-core.module';
import { PluginsCoreModule } from '../plugins/plugins-core.module';
import { SignupCoreModule } from '../signup/signup-core.module';
import { TasksCoreModule } from '../tasks/tasks-core.module';
import { WorkerService } from './worker.service';

@Module({
  imports: [TasksCoreModule, HoneypotCoreModule, SignupCoreModule, PluginsCoreModule],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
