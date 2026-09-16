import { Injectable } from '@nestjs/common';
import { Command } from '../bot/decorators/command.decorator';
import { PlayersService } from './players.service';

@Injectable()
export class PlayersCommand {
  constructor(private readonly playersService: PlayersService) {}

  @Command('list-players')
  async listPlayers(): Promise<string> {
    const players = await this.playersService.findAll();
    const names = players.map((player) => player.name);
    return names.length > 0 ? names.join(', ') : 'No players found.';
  }
}
