import { Module } from '@nestjs/common';
import { PluginKindRegistry } from './plugin-kinds';
import { PluginRunnerService } from './plugin-runner.service';
import { PluginsService } from './plugins.service';

/** Plugin logic that needs only the database and the bot (no HTTP, no login). */
@Module({
  providers: [PluginsService, PluginRunnerService, PluginKindRegistry],
  exports: [PluginsService, PluginRunnerService, PluginKindRegistry],
})
export class PluginsCoreModule {}
