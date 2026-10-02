import { Injectable } from '@nestjs/common';
import { DiscordOAuthService } from '../auth/discord-oauth.service';
import { PrismaService } from '../database/prisma.service';
import { PlayerDto } from './dto/player.dto';

const MAX_NAME_LOOKUPS = 100;

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordOAuthService,
  ) {}

  /** The players with at least one character in one guild's roster, each with that guild's characters only
   * (a player's characters on other servers, or not yet in this guild, are not this guild's business). */
  findForGuild(guildId: string): Promise<PlayerDto[]> {
    return this.findMany(guildId);
  }

  /**
   * Looks up (and stores) the Discord username of the guild's players we don't
   * know by name yet, e.g. registered before names were tracked. An explicit
   * action, not part of listing, so reads never call Discord. Returns how many
   * players were updated.
   */
  async refreshMissingNames(guildId: string): Promise<number> {
    const missing = await this.prisma.player.findMany({
      where: {
        discordUsername: null,
        discordDisplayName: null,
        characters: { some: { guilds: { some: { guildId } } } },
      },
      select: { id: true, discordUserId: true },
      take: MAX_NAME_LOOKUPS,
    });
    const results = await Promise.all(
      missing.map(async (player) => {
        try {
          const profile = await this.discord.fetchUserById(player.discordUserId);
          await this.prisma.player.update({
            where: { id: player.id },
            data: { discordUsername: profile.username, discordDisplayName: profile.global_name },
          });
          return true;
        } catch {
          return false; // Unknown or deleted user: keep showing the id.
        }
      }),
    );
    return results.filter(Boolean).length;
  }

  /** Players in the guild managed from the given Discord server (by Discord id). */
  async findForDiscordServer(discordServerId: string): Promise<PlayerDto[]> {
    const guild = await this.prisma.guild.findFirst({
      where: { servers: { some: { discordId: discordServerId } } },
      select: { id: true },
    });
    return guild ? this.findMany(guild.id) : [];
  }

  private findMany(guildId: string): Promise<PlayerDto[]> {
    return this.prisma.player.findMany({
      where: { characters: { some: { guilds: { some: { guildId } } } } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        discordUserId: true,
        discordUsername: true,
        discordDisplayName: true,
        characters: {
          where: { guilds: { some: { guildId } } },
          orderBy: [{ isMain: 'desc' }, { firstName: 'asc' }],
          select: {
            id: true,
            class: true,
            race: true,
            roles: true,
            firstName: true,
            lastName: true,
            isMain: true,
            level: true,
          },
        },
      },
    });
  }
}
