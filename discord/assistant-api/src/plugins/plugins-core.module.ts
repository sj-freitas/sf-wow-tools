import { Module } from '@nestjs/common';
import { PluginRunnerService } from './plugin-runner.service';
import { PluginsService } from './plugins.service';

/** Plugin logic that needs only the database and the bot (no HTTP, no login). */
@Module({
  providers: [PluginsService, PluginRunnerService],
  exports: [PluginsService, PluginRunnerService],
})
export class PluginsCoreModule {}
