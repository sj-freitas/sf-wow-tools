import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DiscordOAuthService } from './discord-oauth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, DiscordOAuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
