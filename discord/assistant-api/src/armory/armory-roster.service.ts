import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { canManageAllCharacters } from '../auth/access-rules';
import { GuildAccessService } from '../auth/guild-access.service';
import { PrismaService } from '../database/prisma.service';
import { armoryNamespaceFor } from '../game/games';
import {
  ArmoryError,
  ArmoryService,
  type ArmoryGuild,
  type ArmoryGuildMember,
} from './armory.service';

/** The character we already have with an armory member's name, on the guild's server. */
export interface KnownCharacter {
  id: string;
  /** On this guild's roster; otherwise known (another guild's, or none) and addable to it. */
  inGuild: boolean;
  player: { discordUserId: string; username: string | null; displayName: string | null };
}

export type ArmoryGuildMemberDto = ArmoryGuildMember & { character: KnownCharacter | null };

export interface ArmoryGuildRosterDto {
  /** The guild's name and faction as the armory has them. */
  name: string;
  faction: string;
  /** By rank (the Guild Master first), then name. */
  members: ArmoryGuildMemberDto[];
}

/** Names compared the way the game does: whatever the case. */
const nameKey = (firstName: string, lastName: string): string =>
  `${firstName.normalize('NFC').toLocaleLowerCase()} ${lastName.normalize('NFC').toLocaleLowerCase()}`;

/**
 * "Import from armory" (Officers): the guild's members in the armory of its game version and region,
 * each with the character we already have by that name on the guild's server, if any — on the
 * roster, or known and not on it. The backoffice then adds the others, each for the Discord user an
 * Officer picks, through the usual character endpoints (so the same rules apply).
 */
@Injectable()
export class ArmoryRosterService {
  constructor(
    private readonly armory: ArmoryService,
    private readonly guildAccess: GuildAccessService,
    private readonly prisma: PrismaService,
  ) {}

  /** `guildName`: the guild's name in the game, when it isn't the one it has here. */
  async forGuild(
    userId: string,
    guildId: string,
    guildName?: string,
  ): Promise<ArmoryGuildRosterDto> {
    const access = await this.guildAccess.find(userId, guildId);
    if (!access || !canManageAllCharacters(access)) {
      throw new ForbiddenException('Only Officers can import characters from the armory');
    }
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { name: true, gameVersion: true, region: true, realm: true },
    });
    const namespace = guild ? armoryNamespaceFor(guild.gameVersion, guild.region) : null;
    if (!guild || !namespace) {
      throw new ServiceUnavailableException(
        `There is no armory for ${guild?.gameVersion ?? 'this guild'} yet.`,
      );
    }
    let found: ArmoryGuild;
    try {
      found = await this.armory.guildRoster({
        namespace,
        region: guild.region,
        guildName: guildName?.trim() || guild.name,
      });
    } catch (error) {
      if (!(error instanceof ArmoryError)) throw error;
      if (error.failure === 'not-found') throw new NotFoundException(error.message);
      if (error.failure === 'not-configured') throw new ServiceUnavailableException(error.message);
      throw new BadGatewayException(error.message);
    }

    // Every character on the guild's server: a character is its name there, whoever plays it.
    const characters = await this.prisma.character.findMany({
      where: { gameVersion: guild.gameVersion, region: guild.region, realm: guild.realm },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        guilds: { where: { guildId }, select: { guildId: true } },
        player: {
          select: { discordUserId: true, discordUsername: true, discordDisplayName: true },
        },
      },
    });
    const byName = new Map<string, KnownCharacter>();
    for (const character of characters) {
      const key = nameKey(character.firstName, character.lastName);
      const known: KnownCharacter = {
        id: character.id,
        inGuild: character.guilds.length > 0,
        player: {
          discordUserId: character.player.discordUserId,
          username: character.player.discordUsername,
          displayName: character.player.discordDisplayName,
        },
      };
      // A name is unique on a server; should two differ only in case, the one on this roster wins.
      if (!byName.get(key)?.inGuild) byName.set(key, known);
    }

    const members = found.members
      .map((member) => ({
        ...member,
        character: byName.get(nameKey(member.name, member.lastName)) ?? null,
      }))
      .sort(
        (a, b) =>
          a.rank - b.rank || a.name.localeCompare(b.name) || a.lastName.localeCompare(b.lastName),
      );
    return { name: found.name, faction: found.faction, members };
  }
}
