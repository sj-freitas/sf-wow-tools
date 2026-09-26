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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { APP_CONFIG } from '../config/app.config';
import { isRegion, REGIONS, regionOptions } from '../config/regions';
import { games, getGame, isGameVersion, serversOf } from '../game/games';
import { MAX_BANNER_BYTES, readBody } from './banner';
import { RanksService, type RanksDto } from './ranks.service';
import {
  GUILD_ROLE_KEYS,
  GuildsService,
  type GuildRoleKey,
  type CreateGuildInput,
  type EligibleServersDto,
  type GuildDetails,
  type GuildHomeDto,
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
      regions: regionOptions(),
      // What the forms are built from: versions, their servers per region, factions, races and classes.
      games: games(),
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

  /** Any member of the guild: its welcome post (optional). */
  /** The guild's banner image, for any member of the guild. */
  @Get(':guildId/banner')
  async banner(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) throw new ForbiddenException();
    const banner = await this.guildsService.getBanner(guildId);
    if (!banner) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'This guild has no banner' });
      return;
    }
    // The URL carries the version, so a new banner is a new URL and this can be cached.
    res
      .set({ 'Content-Type': banner.contentType, 'Cache-Control': 'private, max-age=86400' })
      .send(banner.data);
  }

  /** Guild-Assistants and Officers. The body is the image itself (PNG, JPEG, GIF or WebP, up to 2 MB). */
  @Put(':guildId/banner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setBanner(@Req() req: AuthenticatedRequest, @Param('guildId') guildId: string) {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    await this.guildsService.setBanner(guildId, await readBody(req, MAX_BANNER_BYTES));
  }

  @Delete(':guildId/banner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeBanner(@Req() req: AuthenticatedRequest, @Param('guildId') guildId: string) {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    await this.guildsService.removeBanner(guildId);
  }

  @Get(':guildId/home')
  async home(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<GuildHomeDto> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    return this.guildsService.getHome(guildId);
  }

  /** Officers only: writes the welcome post. An empty `markdown` removes it. */
  @Put(':guildId/home')
  async setHome(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Payload,
  ): Promise<GuildHomeDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.guildsService.setHome(guildId, req.user.id, body.markdown);
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
  if (!isRegion(body.region)) {
    throw new BadRequestException(`region must be one of ${Object.keys(REGIONS).join(', ')}`);
  }
  const { gameVersion, region } = body;
  const factions = Object.keys(getGame(gameVersion)?.factions ?? {}).map((name) =>
    name.toUpperCase(),
  );
  if (!factions.includes(body.faction)) {
    throw new BadRequestException(`${gameVersion} has no ${body.faction.toLowerCase()} faction`);
  }
  // The server is one the game's config lists for that region.
  const realm = text('realm');
  const servers = serversOf(gameVersion, region);
  if (servers.length === 0) {
    throw new BadRequestException(`${gameVersion} is not available in ${region}`);
  }
  if (!servers.includes(realm)) {
    throw new BadRequestException(
      `The server must be one of ${servers.join(', ')} for ${gameVersion} in ${region}`,
    );
  }
  return {
    name: text('name'),
    realm,
    faction: body.faction,
    gameVersion: body.gameVersion,
    region: body.region,
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
