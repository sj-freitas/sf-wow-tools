import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { TaskRunnerService } from './task-runner.service';
import { TasksService } from './tasks.service';

/** Everything about tasks that needs only the database and the bot (no HTTP, no login). */
@Module({
  providers: [TasksService, TaskRunnerService, SchedulerService],
  exports: [TasksService, TaskRunnerService, SchedulerService],
})
export class TasksCoreModule {}
