import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DiscordOAuthService } from '../auth/discord-oauth.service';
import { PrismaService } from '../database/prisma.service';
import { PlayerDto } from './dto/player.dto';

const MAX_NAME_LOOKUPS_PER_REQUEST = 20;

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordOAuthService,
  ) {}

  /** Players in guilds the given backoffice user belongs to. */
  async findForUser(userId: string): Promise<PlayerDto[]> {
    const players = await this.findMany({ guild: { access: { some: { userId } } } });
    await this.fillMissingNames(players);
    return players;
  }

  /**
   * Looks up (and stores) the Discord username of players we don't know by
   * name yet, e.g. registered before names were tracked. Best effort, capped
   * per request so a large guild can't trigger a burst of Discord calls.
   */
  private async fillMissingNames(players: PlayerDto[]): Promise<void> {
    const missing = players
      .filter((player) => !player.discordUsername && !player.discordDisplayName)
      .slice(0, MAX_NAME_LOOKUPS_PER_REQUEST);
    await Promise.all(
      missing.map(async (player) => {
        try {
          const profile = await this.discord.fetchUserById(player.discordUserId);
          player.discordUsername = profile.username;
          player.discordDisplayName = profile.global_name;
          await this.prisma.player.update({
            where: { id: player.id },
            data: { discordUsername: profile.username, discordDisplayName: profile.global_name },
          });
        } catch {
          // Unknown or deleted user: keep showing the id.
        }
      }),
    );
  }

  /** Players in the guild managed from the given Discord server (by Discord id). */
  findForDiscordServer(discordServerId: string): Promise<PlayerDto[]> {
    return this.findMany({ guild: { servers: { some: { discordId: discordServerId } } } });
  }

  private findMany(where: Prisma.PlayerWhereInput): Promise<PlayerDto[]> {
    return this.prisma.player.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        discordUserId: true,
        discordUsername: true,
        discordDisplayName: true,
        guildId: true,
        characters: {
          orderBy: [{ isMain: 'desc' }, { firstName: 'asc' }],
          select: {
            id: true,
            class: true,
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
