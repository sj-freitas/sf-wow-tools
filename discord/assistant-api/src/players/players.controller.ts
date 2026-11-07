import {
  Controller,
  ForbiddenException,
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
import { CharacterDto, PlayerDto } from './dto/player.dto';
import { PlayersService } from './players.service';

@Controller('guilds/:guildId/players')
@UseGuards(AuthGuard)
export class PlayersController {
  constructor(
    private readonly playersService: PlayersService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  /** The guild's roster: any member of the guild, and only that guild's players. */
  @Get()
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<PlayerDto[]> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    return this.playersService.findForGuild(guildId);
  }

  /** The guild's unclaimed characters (no player yet): any member of the guild, like the roster. */
  @Get('unclaimed')
  async findUnclaimed(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<CharacterDto[]> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    return this.playersService.findUnclaimedForGuild(guildId);
  }

  /** Officers: fill in missing Discord usernames of the guild's players. */
  @Post('refresh-names')
  @HttpCode(HttpStatus.OK)
  async refreshNames(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<{ updated: number }> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return { updated: await this.playersService.refreshMissingNames(guildId) };
  }
}
