import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GuildsController } from './guilds.controller';
import { GuildRedirectsService } from './guild-redirects.service';
import { GuildsService } from './guilds.service';
import { RanksService } from './ranks.service';

@Module({
  imports: [AuthModule],
  controllers: [GuildsController],
  providers: [GuildsService, RanksService, GuildRedirectsService],
  exports: [GuildRedirectsService, GuildsService],
})
export class GuildsModule {}
