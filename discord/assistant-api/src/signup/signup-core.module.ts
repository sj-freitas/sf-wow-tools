import { Module } from '@nestjs/common';
import { SignupEventsService } from './signup-events.service';
import { SignupSchedulerService } from './signup-scheduler.service';

/** What the background worker needs of event sign-ups: only the database and the bot. */
@Module({
  providers: [SignupEventsService, SignupSchedulerService],
  exports: [SignupEventsService, SignupSchedulerService],
})
export class SignupCoreModule {}
