import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { PlayerDto } from './dto/player.dto';
import { PlayersService } from './players.service';

@Controller('players')
@UseGuards(AuthGuard)
export class PlayersController {
  constructor(
    private readonly playersService: PlayersService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  @Get()
  findAll(@Req() req: AuthenticatedRequest): Promise<PlayerDto[]> {
    return this.playersService.findForUser(req.user.id);
  }

  /** Officers: fill in missing Discord usernames of the guild's players. */
  @Post('guild/:guildId/refresh-names')
  @HttpCode(HttpStatus.OK)
  async refreshNames(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<{ updated: number }> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return { updated: await this.playersService.refreshMissingNames(guildId) };
  }
}
