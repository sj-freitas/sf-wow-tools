import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ArmoryLookupService, type ArmoryCharacterDto } from './armory-lookup.service';

export type { ArmoryCharacterDto } from './armory-lookup.service';

/** "Load from armory" for the character form: anyone in the guild. */
@Controller('guilds/:guildId/armory')
@UseGuards(AuthGuard)
export class ArmoryController {
  constructor(private readonly lookup: ArmoryLookupService) {}

  @Get('character')
  character(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('name') name?: string,
    @Query('lastName') lastName?: string,
  ): Promise<ArmoryCharacterDto> {
    return this.lookup.forGuild(req.user.id, guildId, name ?? '', lastName ?? '');
  }
}
