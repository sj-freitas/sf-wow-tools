import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG } from '../config/app.config';
import { botInviteUrl } from '../config/bot-invite';

export interface PublicInfoDto {
  /** Adds the bot to a Discord server (`BOT_INVITE_URL`, else built from the application id). */
  botInviteUrl: string;
  /** The Discord role that lets someone set a guild up, for the "how it works" steps. */
  adminRoleName: string;
  /** Who to contact about the site and its data (`CONTACT_EMAIL`); null when not set. */
  contactEmail: string | null;
}

/** What the landing and privacy pages show before anyone logs in. No login needed, nothing private. */
@Controller('public')
export class PublicController {
  private readonly info: PublicInfoDto;

  constructor(configService: ConfigService) {
    this.info = {
      botInviteUrl: botInviteUrl(configService),
      adminRoleName: APP_CONFIG.adminRoleName,
      contactEmail: configService.get<string>('CONTACT_EMAIL')?.trim() || null,
    };
  }

  @Get('info')
  getInfo(): PublicInfoDto {
    return this.info;
  }
}
