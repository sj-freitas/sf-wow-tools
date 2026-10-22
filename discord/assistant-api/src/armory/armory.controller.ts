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
import { PrismaService } from '../database/prisma.service';
import { getGame } from '../game/games';
import { ArmoryError, ArmoryService, type ArmoryCharacter } from './armory.service';
import { inferSpecs, type SpecInference } from './spec-roles';

/** The armory's character, with its specs and roles worked out (EXPERIMENTAL). */
export type ArmoryCharacterDto = ArmoryCharacter & { specs: SpecInference };

/** TEST: "Load from armory" for the character form. Officers only. */
@Controller('guilds/:guildId/armory')
@UseGuards(AuthGuard)
export class ArmoryController {
  constructor(
    private readonly armory: ArmoryService,
    private readonly guildAccess: GuildAccessService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('character')
  async character(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('name') name?: string,
  ): Promise<ArmoryCharacterDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    let found: ArmoryCharacter;
    try {
      found = await this.armory.lookup(name ?? '');
    } catch (error) {
      if (!(error instanceof ArmoryError)) throw error;
      if (error.failure === 'not-found') throw new NotFoundException(error.message);
      if (error.failure === 'not-configured') throw new ServiceUnavailableException(error.message);
      throw new BadGatewayException(error.message);
    }
    // Specs as the guild's game version defines them (its classes' specs and their roles).
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { gameVersion: true },
    });
    const game = guild ? getGame(guild.gameVersion) : undefined;
    return { ...found, specs: inferSpecs(game, found.class, found.talents) };
  }
}
