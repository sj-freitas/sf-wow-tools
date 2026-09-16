import { Controller, Get } from '@nestjs/common';
import { PlayerDto } from './dto/player.dto';
import { PlayersService } from './players.service';

@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Get()
  findAll(): Promise<PlayerDto[]> {
    return this.playersService.findAll();
  }
}
