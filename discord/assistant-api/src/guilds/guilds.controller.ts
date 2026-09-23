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
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import {
  GuildsService,
  isGameVersion,
  type CreateGuildInput,
  type EligibleServersDto,
  type UserGuildDto,
} from './guilds.service';

@Controller('guilds')
@UseGuards(AuthGuard)
export class GuildsController {
  constructor(
    private readonly guildsService: GuildsService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  /** Guilds the logged-in user belongs to, with whether they can manage them. */
  @Get()
  list(@Req() req: AuthenticatedRequest): Promise<UserGuildDto[]> {
    return this.guildsService.findForUser(req.user.id);
  }

  @Get('eligible-servers')
  eligibleServers(@Req() req: AuthenticatedRequest): Promise<EligibleServersDto> {
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
