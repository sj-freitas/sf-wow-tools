import { ForbiddenException, Injectable } from '@nestjs/common';
import { GuildAccessService } from '../auth/guild-access.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { PrismaService } from '../database/prisma.service';
import type { SignupGuild } from './signup-events.service';
import type { SignupViewer } from './signup-rules';

/** How long a member's roles in the main server are trusted before asking Discord again. */
const ROLE_CACHE_MS = 60 * 1000;

/**
 * Who someone is for the sign-up feature: an Officer (the guild's Officer role in its main
 * server) and/or an EventCreator (the role set in the sign-up settings; Officers always count).
 */
@Injectable()
export class SignupAccessService {
  private readonly roleCache = new Map<string, { roles: string[]; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly guildAccess: GuildAccessService,
    private readonly discord: DiscordBotService,
  ) {}

  /**
   * A logged-in backoffice user. Throws unless they are in the guild (in one of its servers).
   * Officer comes from their login's access row; EventCreator is read from Discord.
   */
  async forUser(
    user: { id: string; discordId: string },
    guild: SignupGuild,
  ): Promise<SignupViewer> {
    const access = await this.guildAccess.find(user.id, guild.id);
    if (!access) throw new ForbiddenException('You are not in this guild');
    if (access.isOfficer) {
      return { discordId: user.discordId, isOfficer: true, isEventCreator: true };
    }
    const creatorRole = await this.eventCreatorRole(guild.id);
    const roles = creatorRole ? await this.mainServerRoles(guild, user.discordId) : [];
    return {
      discordId: user.discordId,
      isOfficer: false,
      isEventCreator: creatorRole !== null && roles.includes(creatorRole),
    };
  }

  /**
   * Someone using the bot in `serverId`. Their roles come with the interaction when that is the
   * guild's main server; otherwise they are read from the main server.
   */
  async forDiscordMember(
    guild: SignupGuild,
    member: { id: string; roleIds?: readonly string[] },
    serverId: string,
  ): Promise<SignupViewer> {
    const main = guild.servers.find((server) => server.isMain)?.discordId;
    const creatorRole = await this.eventCreatorRole(guild.id);
    if (!main || (!guild.officerRoleId && !creatorRole)) {
      return { discordId: member.id, isOfficer: false, isEventCreator: false };
    }
    const roles =
      main === serverId && member.roleIds
        ? [...member.roleIds]
        : await this.mainServerRoles(guild, member.id);
    const isOfficer = guild.officerRoleId !== null && roles.includes(guild.officerRoleId);
    return {
      discordId: member.id,
      isOfficer,
      isEventCreator: isOfficer || (creatorRole !== null && roles.includes(creatorRole)),
    };
  }

  private async eventCreatorRole(guildId: string): Promise<string | null> {
    const settings = await this.prisma.signupSettings.findUnique({
      where: { guildId },
      select: { eventCreatorRoleId: true },
    });
    return settings?.eventCreatorRoleId ?? null;
  }

  private async mainServerRoles(guild: SignupGuild, discordUserId: string): Promise<string[]> {
    const main = guild.servers.find((server) => server.isMain)?.discordId;
    if (!main) return [];
    const key = `${main}:${discordUserId}`;
    const cached = this.roleCache.get(key);
    if (cached && Date.now() - cached.at < ROLE_CACHE_MS) return cached.roles;
    const roles = await this.discord.fetchMemberRoles(main, discordUserId);
    this.roleCache.set(key, { roles, at: Date.now() });
    return roles;
  }
}
