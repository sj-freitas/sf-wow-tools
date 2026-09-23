import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlayersCommand } from './players.command';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';

@Module({
  imports: [AuthModule],
  controllers: [PlayersController],
  providers: [PlayersService, PlayersCommand],
})
export class PlayersModule {}
