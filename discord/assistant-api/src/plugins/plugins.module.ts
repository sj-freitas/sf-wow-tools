import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PluginsController } from './plugins.controller';
import { PluginsCoreModule } from './plugins-core.module';

@Module({
  imports: [AuthModule, PluginsCoreModule],
  controllers: [PluginsController],
})
export class PluginsModule {}
