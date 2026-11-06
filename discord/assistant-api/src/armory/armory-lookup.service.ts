import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GuildAccessService } from '../auth/guild-access.service';
import { PrismaService } from '../database/prisma.service';
import { armoryNamespaceFor, getGame } from '../game/games';
import { ArmoryError, ArmoryService, type ArmoryCharacter } from './armory.service';
import { inferSpecs, type SpecInference } from './spec-roles';

/** The armory's character, with its specs and roles worked out (EXPERIMENTAL). */
export type ArmoryCharacterDto = ArmoryCharacter & { specs: SpecInference };

/**
 * A character looked up in the armory of a guild's game version and region, for anyone in the
 * guild: "Load from armory" in the character form (`ArmoryController`) and the MCP server's
 * `look_up_armory` (`ArmoryMcpTools`).
 */
@Injectable()
export class ArmoryLookupService {
  constructor(
    private readonly armory: ArmoryService,
    private readonly guildAccess: GuildAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async forGuild(
    userId: string,
    guildId: string,
    name: string,
    lastName: string,
  ): Promise<ArmoryCharacterDto> {
    if (!(await this.guildAccess.find(userId, guildId))) {
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
      found = await this.armory.lookup({ namespace, region: guild.region, name, lastName });
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
