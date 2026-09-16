import { Module } from '@nestjs/common';
import { PlayersCommand } from './players.command';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';

@Module({
  controllers: [PlayersController],
  providers: [PlayersService, PlayersCommand],
})
export class PlayersModule {}
