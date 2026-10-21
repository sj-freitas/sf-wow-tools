import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignupAccessService } from './signup-access.service';
import { SignupAssignmentsService } from './signup-assignments.service';
import { SignupCoreModule } from './signup-core.module';
import { SignupEntriesService } from './signup-entries.service';
import { SignupRemindersService } from './signup-reminders.service';
import { McpToolRegistryModule } from '../mcp/mcp-tool-registry';
import { PluginsCoreModule } from '../plugins/plugins-core.module';
import { SignupMcpTools } from './signup-mcp-tools';
import { SignupUserEventsService } from './signup-user-events.service';
import { SignupCommand } from './signup.command';
import { SignupController } from './signup.controller';

/**
 * Event sign-ups (like Raid-Helper): `/create-event` and the sign-up post's buttons in Discord,
 * and `/api/guilds/:guildId/signup/...` for the backoffice. Self-contained on purpose — its own
 * tables (prisma/signup.prisma), its own folder here and in the backoffice — so it can be taken
 * out on its own; see "Removing the sign-up feature" in the README.
 */
@Module({
  imports: [AuthModule, SignupCoreModule, PluginsCoreModule, McpToolRegistryModule],
  controllers: [SignupController],
  providers: [
    SignupAccessService,
    SignupEntriesService,
    SignupAssignmentsService,
    SignupRemindersService,
    SignupCommand,
    SignupUserEventsService,
    SignupMcpTools,
  ],
})
export class SignupModule {}
