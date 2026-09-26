import {
  BadGatewayException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { ArmoryError, ArmoryService, type ArmoryCharacter } from './armory.service';

/** TEST: "Load from armory" for the character form. Officers only. */
@Controller('guilds/:guildId/armory')
@UseGuards(AuthGuard)
export class ArmoryController {
  constructor(
    private readonly armory: ArmoryService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  @Get('character')
  async character(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('name') name?: string,
  ): Promise<ArmoryCharacter> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    try {
      return await this.armory.lookup(name ?? '');
    } catch (error) {
      if (!(error instanceof ArmoryError)) throw error;
      if (error.failure === 'not-found') throw new NotFoundException(error.message);
      if (error.failure === 'not-configured') throw new ServiceUnavailableException(error.message);
      throw new BadGatewayException(error.message);
    }
  }
}
