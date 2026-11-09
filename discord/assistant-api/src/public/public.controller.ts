import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG } from '../config/app.config';
import { botInviteUrl } from '../config/bot-invite';
import { classIcon, markerIcon, roleIcon } from '../game/games';

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

  /**
   * A Discord profile, by way of a redirect to `https://discord.com/users/<id>`. The Professions
   * List links each crafter's player here instead of to Discord directly: Discord puts a profile
   * card under a message for every discord.com/users link, link previews off or not. Only a Discord
   * id is accepted (17 to 20 digits), so it never sends anyone anywhere else.
   */
  @Get('discord/users/:id')
  discordProfile(@Param('id') id: string, @Res() res: Response): void {
    if (!/^\d{17,20}$/.test(id)) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'No such Discord user' });
      return;
    }
    res.redirect(HttpStatus.FOUND, `https://discord.com/users/${id}`);
  }

  /** A class's icon (game artwork, not private), for the website; 404 when it has none. */
  @Get('games/:gameVersion/classes/:className/icon')
  classIcon(
    @Param('gameVersion') gameVersion: string,
    @Param('className') className: string,
    @Res() res: Response,
  ): void {
    this.sendIcon(res, classIcon(gameVersion, className));
  }

  /** A raid marker's icon (`Skull`, ...), for the website; 404 when it has none. */
  @Get('games/:gameVersion/markers/:marker/icon')
  markerIcon(
    @Param('gameVersion') gameVersion: string,
    @Param('marker') marker: string,
    @Res() res: Response,
  ): void {
    this.sendIcon(res, markerIcon(gameVersion, marker));
  }

  /** A role's icon (`Tank`, `Healer`, `Melee`, `Ranged`, `Leader`); 404 when it has none. */
  @Get('games/:gameVersion/roles/:role/icon')
  roleIcon(
    @Param('gameVersion') gameVersion: string,
    @Param('role') role: string,
    @Res() res: Response,
  ): void {
    this.sendIcon(res, roleIcon(gameVersion, role));
  }

  private sendIcon(res: Response, icon: ReturnType<typeof classIcon>): void {
    res.set('Cache-Control', 'public, max-age=86400');
    if (!icon) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'No icon' });
      return;
    }
    res.set({ 'Content-Type': icon.contentType, 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(icon.file);
  }
}
