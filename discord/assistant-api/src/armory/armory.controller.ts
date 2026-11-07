import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ArmoryLookupService, type ArmoryCharacterDto } from './armory-lookup.service';
import { ArmoryRosterService, type ArmoryGuildRosterDto } from './armory-roster.service';

export type { ArmoryCharacterDto } from './armory-lookup.service';
export type { ArmoryGuildRosterDto } from './armory-roster.service';

@Controller('guilds/:guildId/armory')
@UseGuards(AuthGuard)
export class ArmoryController {
  constructor(
    private readonly lookup: ArmoryLookupService,
    private readonly roster: ArmoryRosterService,
  ) {}

  /** "Load from armory" for the character form: anyone in the guild. */
  @Get('character')
  character(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('name') name?: string,
    @Query('lastName') lastName?: string,
  ): Promise<ArmoryCharacterDto> {
    return this.lookup.forGuild(req.user.id, guildId, name ?? '', lastName ?? '');
  }

  /**
   * "Import from armory": the guild's members in the armory, each with the character we have by
   * that name (Officers). `name`: the guild's name in the game, when it differs from this one's.
   */
  @Get('guild')
  guild(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('name') name?: string,
  ): Promise<ArmoryGuildRosterDto> {
    return this.roster.forGuild(req.user.id, guildId, name);
  }
}
