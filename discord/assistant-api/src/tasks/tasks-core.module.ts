import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { TaskRunnerService } from './task-runner.service';
import { TasksService } from './tasks.service';
import { TrackingService } from './tracking.service';

/** Everything about tasks that needs only the database and the bot (no HTTP, no login). */
@Module({
  providers: [TasksService, TaskRunnerService, SchedulerService, TrackingService],
  exports: [TasksService, TaskRunnerService, SchedulerService, TrackingService],
})
export class TasksCoreModule {}
