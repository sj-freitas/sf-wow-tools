import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { APP_CONFIG } from '../config/app.config';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import {
  GuildsService,
  isGameVersion,
  type CreateGuildInput,
  type EligibleServersDto,
  type SetupInfoDto,
  type UserGuildDto,
} from './guilds.service';

@Controller('guilds')
@UseGuards(AuthGuard)
export class GuildsController {
  private readonly applicationId: string;

  constructor(
    private readonly guildsService: GuildsService,
    private readonly guildAccess: GuildAccessService,
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    this.applicationId = configService.getOrThrow<string>('DISCORD_APPLICATION_ID');
  }

  /** Guilds the logged-in user belongs to, with whether they can manage them. */
  @Get()
  list(@Req() req: AuthenticatedRequest): Promise<UserGuildDto[]> {
    return this.guildsService.findForUser(req.user.id);
  }

  /** How to get a server ready for Guild Assistant, including the bot invite link. */
  @Get('setup-info')
  setupInfo(): SetupInfoDto {
    const params = new URLSearchParams({
      client_id: this.applicationId,
      scope: 'bot applications.commands',
      permissions: APP_CONFIG.botInvitePermissions,
    });
    return {
      adminRoleName: APP_CONFIG.adminRoleName,
      botInviteUrl: `https://discord.com/oauth2/authorize?${params.toString()}`,
    };
  }

  /** Re-reads the user's servers and roles from Discord first, so the list is current. */
  @Get('eligible-servers')
  async eligibleServers(@Req() req: AuthenticatedRequest): Promise<EligibleServersDto> {
    await this.authService.refresh(req.sessionToken, { force: true });
    return this.guildsService.findEligibleServers(req.user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<UserGuildDto> {
    return this.guildsService.create(req.user.id, parseCreateGuild(body));
  }

  @Delete(':guildId/servers/:discordServerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeServer(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('discordServerId') discordServerId: string,
  ): Promise<void> {
    await this.guildAccess.assertAdmin(req.user.id, guildId);
    await this.guildsService.removeServer(guildId, discordServerId);
  }
}

function parseCreateGuild(body: Record<string, unknown>): CreateGuildInput {
  const text = (key: 'name' | 'realm'): string => {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (value.length === 0 || value.length > 64) {
      throw new BadRequestException(`${key} must be 1-64 characters`);
    }
    return value;
  };

  if (body.faction !== 'ALLIANCE' && body.faction !== 'HORDE') {
    throw new BadRequestException('faction must be ALLIANCE or HORDE');
  }
  if (!isGameVersion(body.gameVersion)) {
    throw new BadRequestException('Unsupported game version');
  }
  const ids = body.discordServerIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    throw new BadRequestException('Pick at least one Discord server');
  }

  return {
    name: text('name'),
    realm: text('realm'),
    faction: body.faction,
    gameVersion: body.gameVersion,
    discordServerIds: [...new Set(ids)],
  };
}
