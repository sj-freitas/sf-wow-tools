import { Injectable } from '@nestjs/common';
import { Command } from '../bot/decorators/command.decorator';
import type { DiscordInteraction } from '../bot/discord-interaction.types';
import { PlayersService } from './players.service';

@Injectable()
export class PlayersCommand {
  constructor(private readonly playersService: PlayersService) {}

  @Command('list-players', { ephemeral: true })
  async listPlayers(interaction: DiscordInteraction): Promise<string> {
    if (!interaction.guild_id) {
      return 'This command can only be used inside a server.';
    }
    const players = await this.playersService.findForDiscordServer(interaction.guild_id);
    const mentions = players.map((player) => `<@${player.discordUserId}>`);
    return mentions.length > 0 ? mentions.join(', ') : 'No players found.';
  }
}
