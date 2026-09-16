import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CommandExplorerService } from './command-explorer.service';
import { CommandRegistryService } from './command-registry.service';
import { DiscordInteractionsController } from './discord-interactions.controller';

/**
 * Everything Discord-specific: the @Command() discovery/dispatch framework
 * and the HTTP Interactions Endpoint controller. Feature modules (e.g.
 * PlayersModule) provide their own @Command()-decorated classes, which
 * CommandExplorerService picks up automatically — nothing to register here
 * per command.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [DiscordInteractionsController],
  providers: [CommandExplorerService, CommandRegistryService],
  exports: [CommandRegistryService],
})
export class BotModule {}
