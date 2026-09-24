import { Injectable, Logger } from '@nestjs/common';
import { DiscordOAuthService } from '../auth/discord-oauth.service';
import { APP_CONFIG } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ranksFor, type Rank, type RankRoleIds } from './ranks';

/** Discord user id -> ranks, only for players that hold at least one. */
export type RanksDto = Record<string, Rank[]>;

const MAX_PLAYER_LOOKUPS = 100;

/**
 * Works out each player's ranks (Officer, Raider, Social) from the roles they
 * currently hold in the guild's main server. Nothing is stored: results are
 * only kept in memory for a short while so repeated views don't call Discord.
 */
@Injectable()
export class RanksService {
  private readonly logger = new Logger(RanksService.name);
  private readonly cache = new Map<string, { at: number; ranks: RanksDto }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordOAuthService,
    realtime: RealtimeService,
  ) {
    // Role settings, servers or the main server changed: don't serve the old ranks.
    realtime.events.subscribe((event) => {
      if (event.type === 'guild') {
        this.cache.delete(event.guildId);
      }
    });
  }

  async findRanks(guildId: string): Promise<RanksDto> {
    const cached = this.cache.get(guildId);
    if (cached && Date.now() - cached.at < APP_CONFIG.ranksCacheMs) {
      return cached.ranks;
    }
    const ranks = await this.compute(guildId);
    this.cache.set(guildId, { at: Date.now(), ranks });
    return ranks;
  }

  private async compute(guildId: string): Promise<RanksDto> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: {
        officerRoleId: true,
        roleMappings: { select: { guildRole: true, discordRoleId: true } },
        servers: { where: { isMain: true }, select: { discordId: true } },
        players: { select: { discordUserId: true } },
      },
    });
    const main = guild?.servers[0];
    if (!guild || !main) {
      return {};
    }
    const roleIds: RankRoleIds = {
      officer: guild.officerRoleId,
      raider: guild.roleMappings.find((m) => m.guildRole === 'RAIDER')?.discordRoleId ?? null,
      social: guild.roleMappings.find((m) => m.guildRole === 'SOCIAL')?.discordRoleId ?? null,
    };
    if (!roleIds.officer && !roleIds.raider && !roleIds.social) {
      return {};
    }

    const playerIds = guild.players.map((player) => player.discordUserId);
    const rolesByUser = await this.readMemberRoles(main.discordId, playerIds);
    const ranks: RanksDto = {};
    for (const userId of playerIds) {
      const userRanks = ranksFor(rolesByUser.get(userId) ?? [], roleIds);
      if (userRanks.length > 0) {
        ranks[userId] = userRanks;
      }
    }
    return ranks;
  }

  /**
   * Role ids per user in the main server. One paginated member listing when
   * Discord allows it (Server Members intent), otherwise one lookup per player.
   */
  private async readMemberRoles(
    serverId: string,
    playerIds: string[],
  ): Promise<Map<string, string[]>> {
    try {
      const members = await this.discord.fetchServerMembers(serverId);
      return new Map(members.map((member) => [member.user.id, member.roles]));
    } catch (error) {
      this.logger.warn(
        `Could not list members of ${serverId}, looking players up: ${String(error)}`,
      );
    }
    const lookups = await Promise.allSettled(
      playerIds
        .slice(0, MAX_PLAYER_LOOKUPS)
        .map(
          async (id) => [id, (await this.discord.fetchServerMember(serverId, id)).roles] as const,
        ),
    );
    return new Map(
      lookups.flatMap((lookup) => (lookup.status === 'fulfilled' ? [lookup.value] : [])),
    );
  }
}
