import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TasksController } from './tasks.controller';
import { TasksCoreModule } from './tasks-core.module';

@Module({
  imports: [AuthModule, TasksCoreModule],
  controllers: [TasksController],
})
export class TasksModule {}
