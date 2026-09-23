import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { GuildAccessService } from './guild-access.service';
import { DiscordOAuthService } from './discord-oauth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, DiscordOAuthService, AuthGuard, GuildAccessService],
  exports: [AuthService, AuthGuard, GuildAccessService],
})
export class AuthModule {}
