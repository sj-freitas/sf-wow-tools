import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GuildsController } from './guilds.controller';
import { GuildsService } from './guilds.service';
import { RanksService } from './ranks.service';

@Module({
  imports: [AuthModule],
  controllers: [GuildsController],
  providers: [GuildsService, RanksService],
})
export class GuildsModule {}
