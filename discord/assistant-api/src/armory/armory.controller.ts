import {
  BadGatewayException,
  Controller,
  ForbiddenException,
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
import { armoryNamespaceFor, getGame } from '../game/games';
import { ArmoryError, ArmoryService, type ArmoryCharacter } from './armory.service';
import { inferSpecs, type SpecInference } from './spec-roles';

/** The armory's character, with its specs and roles worked out (EXPERIMENTAL). */
export type ArmoryCharacterDto = ArmoryCharacter & { specs: SpecInference };

/** "Load from armory" for the character form: anyone in the guild. */
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
    @Query('lastName') lastName?: string,
  ): Promise<ArmoryCharacterDto> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) {
      throw new ForbiddenException('You are not in this guild');
    }
    // The guild's game version and region say which armory to ask.
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { gameVersion: true, region: true },
    });
    const namespace = guild ? armoryNamespaceFor(guild.gameVersion, guild.region) : null;
    if (!guild || !namespace) {
      throw new ServiceUnavailableException(
        `There is no armory for ${guild?.gameVersion ?? 'this guild'} yet.`,
      );
    }
    let found: ArmoryCharacter;
    try {
      found = await this.armory.lookup({
        namespace,
        region: guild.region,
        name: name ?? '',
        lastName: lastName ?? '',
      });
    } catch (error) {
      if (!(error instanceof ArmoryError)) throw error;
      if (error.failure === 'not-found') throw new NotFoundException(error.message);
      if (error.failure === 'not-configured') throw new ServiceUnavailableException(error.message);
      throw new BadGatewayException(error.message);
    }
    // Specs as the guild's game version defines them (its classes' specs and their roles).
    return { ...found, specs: inferSpecs(getGame(guild.gameVersion), found.class, found.talents) };
  }
}
