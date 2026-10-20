import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GuildsModule } from '../guilds/guilds.module';
import { PlayersModule } from '../players/players.module';
import { PluginsCoreModule } from '../plugins/plugins-core.module';
import { TasksCoreModule } from '../tasks/tasks-core.module';
import { McpOAuthController } from './mcp-oauth.controller';
import { McpOAuthProvider } from './mcp-oauth.provider';
import { McpController } from './mcp.controller';
import { McpToolRegistryModule } from './mcp-tool-registry';
import { McpToolsService } from './mcp-tools.service';

/** The MCP server for AI agents (`/api/mcp`) and the OAuth flow that connects them. */
@Module({
  imports: [
    AuthModule,
    GuildsModule,
    PlayersModule,
    TasksCoreModule,
    PluginsCoreModule,
    McpToolRegistryModule,
  ],
  controllers: [McpController, McpOAuthController],
  providers: [McpOAuthProvider, McpToolsService],
  exports: [McpOAuthProvider],
})
export class McpModule {}
