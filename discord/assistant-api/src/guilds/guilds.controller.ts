import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { APP_CONFIG } from '../config/app.config';
import { RanksService, type RanksDto } from './ranks.service';
import {
  GUILD_ROLE_KEYS,
  GuildsService,
  isGameVersion,
  type GuildRoleKey,
  type CreateGuildInput,
  type EligibleServersDto,
  type GuildDetails,
  type PeopleDto,
  type RoleOptionDto,
  type SetupInfoDto,
  type UserGuildDto,
} from './guilds.service';

type Payload = Record<string, unknown>;

@Controller('guilds')
@UseGuards(AuthGuard)
export class GuildsController {
  private readonly applicationId: string;

  constructor(
    private readonly guildsService: GuildsService,
    private readonly guildAccess: GuildAccessService,
    private readonly authService: AuthService,
    private readonly ranksService: RanksService,
    configService: ConfigService,
  ) {
    this.applicationId = configService.getOrThrow<string>('DISCORD_APPLICATION_ID');
  }

  /** Guilds the logged-in user belongs to, with what they're allowed to do in each. */
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

  /**
   * Re-reads the user's servers and roles from Discord (at most once per
   * `discordForceSyncMinIntervalMs` per user, so it can't be used to hammer Discord).
   */
  @Post('sync')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sync(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.authService.refresh(req.sessionToken, { force: true });
  }

  /** Servers where the user holds the admin role that don't belong to a guild yet. */
  @Get('eligible-servers')
  eligibleServers(@Req() req: AuthenticatedRequest): Promise<EligibleServersDto> {
    return this.guildsService.findEligibleServers(req.user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: AuthenticatedRequest, @Body() body: Payload): Promise<UserGuildDto> {
    return this.guildsService.create(req.user.id, parseCreateGuild(body));
  }

  @Patch(':guildId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Payload,
  ): Promise<void> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    await this.guildsService.update(guildId, parseGuildDetails(body));
  }

  @Delete(':guildId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest, @Param('guildId') guildId: string): Promise<void> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    await this.guildsService.delete(guildId);
  }

  @Post(':guildId/servers')
  @HttpCode(HttpStatus.NO_CONTENT)
  async addServer(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Payload,
  ): Promise<void> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    await this.guildsService.addServer(
      req.user.id,
      guildId,
      requireString(body, 'discordServerId'),
    );
  }

  @Delete(':guildId/servers/:discordServerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeServer(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('discordServerId') discordServerId: string,
  ): Promise<void> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    await this.guildsService.removeServer(guildId, discordServerId);
  }

  /** Decides where the Officer role lives. */
  @Put(':guildId/main-server')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setMainServer(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Payload,
  ): Promise<void> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    await this.guildsService.setMainServer(guildId, requireString(body, 'discordServerId'));
  }

  @Get(':guildId/role-options')
  async roleOptions(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<RoleOptionDto[]> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    return this.guildsService.listRoleOptions(guildId);
  }

  /** `roleId: null` clears the Officer role. */
  @Put(':guildId/officer-role')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOfficerRole(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Payload,
  ): Promise<void> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    await this.guildsService.setOfficerRole(
      guildId,
      body.roleId === null ? null : requireString(body, 'roleId'),
    );
  }

  /**
   * Officers only. Maps the Raider or Social guild role to a role of the main server
   * (`roleId: null` clears it). Optional; meant to help with roster setup later.
   */
  @Put(':guildId/role-mappings/:guildRole')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setRoleMapping(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('guildRole') guildRole: string,
    @Body() body: Payload,
  ): Promise<void> {
    if (!GUILD_ROLE_KEYS.includes(guildRole as GuildRoleKey)) {
      throw new BadRequestException(`guildRole must be one of ${GUILD_ROLE_KEYS.join(', ')}`);
    }
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    await this.guildsService.setRoleMapping(
      guildId,
      guildRole as GuildRoleKey,
      body.roleId === null ? null : requireString(body, 'roleId'),
    );
  }

  /**
   * Any member of the guild. Officer/Raider/Social ranks of its players, read live from
   * their Discord roles in the main server (nothing is stored).
   */
  @Get(':guildId/ranks')
  async ranks(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<RanksDto> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    return this.ranksService.findRanks(guildId);
  }

  /** Officers only: candidates for the "add character for a player" search. */
  @Get(':guildId/people')
  async people(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<PeopleDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.guildsService.findPeople(guildId);
  }
}

function requireString(body: Payload, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(`${key} is required`);
  }
  return value;
}

function parseGuildDetails(body: Payload): GuildDetails {
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
  return {
    name: text('name'),
    realm: text('realm'),
    faction: body.faction,
    gameVersion: body.gameVersion,
  };
}

function parseCreateGuild(body: Payload): CreateGuildInput {
  const ids = body.discordServerIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    throw new BadRequestException('Pick at least one Discord server');
  }
  const discordServerIds = [...new Set(ids)];
  return {
    ...parseGuildDetails(body),
    discordServerIds,
    mainServerId: typeof body.mainServerId === 'string' ? body.mainServerId : discordServerIds[0],
  };
}
