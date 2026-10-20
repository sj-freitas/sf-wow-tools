import { Module } from '@nestjs/common';
import { PluginsCoreModule } from '../plugins/plugins-core.module';
import { RecurringEventPlugin } from './recurring-event.plugin';
import { SignupEventsService } from './signup-events.service';
import { SignupSchedulerService } from './signup-scheduler.service';

/**
 * What the background worker needs of event sign-ups: only the database and the bot. It also adds
 * the Recurring Event plugin kind, so both the API (Plugins tab) and the worker (runs) know it.
 */
@Module({
  imports: [PluginsCoreModule],
  providers: [SignupEventsService, SignupSchedulerService, RecurringEventPlugin],
  exports: [SignupEventsService, SignupSchedulerService],
})
export class SignupCoreModule {}
