import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';
import type { SessionUser } from './auth.types';
import { DiscordOAuthService, type DiscordPartialGuild } from './discord-oauth.service';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordOAuthService,
  ) {}

  /** Completes the OAuth flow: upserts the user, syncs guild membership, opens a session. */
  async loginWithCode(code: string): Promise<string> {
    const accessToken = await this.discord.exchangeCode(code);
    const [discordUser, discordGuilds] = await Promise.all([
      this.discord.fetchUser(accessToken),
      this.discord.fetchGuilds(accessToken),
    ]);

    const user = await this.prisma.user.upsert({
      where: { discordId: discordUser.id },
      create: {
        discordId: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar,
      },
      update: { username: discordUser.username, avatar: discordUser.avatar },
    });

    const adminServers = await this.findAdminServers(accessToken, discordGuilds);
    const adminServerIds = new Set(adminServers.map((server) => server.id));
    const userServerIds = discordGuilds.map((guild) => guild.id);

    const guilds = await this.prisma.guild.findMany({
      where: { servers: { some: { discordId: { in: userServerIds } } } },
      select: { id: true, servers: { select: { discordId: true } } },
    });
    // Admin of a guild = holds the role in *every* one of its Discord servers.
    const adminGuildIds = new Set(
      guilds
        .filter((guild) => guild.servers.every((server) => adminServerIds.has(server.discordId)))
        .map((guild) => guild.id),
    );

    await this.prisma.$transaction([
      this.prisma.guildAccess.deleteMany({ where: { userId: user.id } }),
      this.prisma.guildAccess.createMany({
        data: guilds.map((guild) => ({
          userId: user.id,
          guildId: guild.id,
          isAdmin: adminGuildIds.has(guild.id),
        })),
      }),
      this.prisma.userAdminServer.deleteMany({ where: { userId: user.id } }),
      this.prisma.userAdminServer.createMany({
        data: adminServers.map((server) => ({
          userId: user.id,
          discordId: server.id,
          name: server.name,
        })),
      }),
      ...discordGuilds.map((guild) =>
        this.prisma.discordServer.updateMany({
          where: { discordId: guild.id },
          data: { name: guild.name },
        }),
      ),
    ]);

    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }

  /**
   * Servers (among the user's) where the bot is present and the user holds the
   * admin role. The bot must be present to read the server's role list.
   */
  private async findAdminServers(
    accessToken: string,
    userServers: DiscordPartialGuild[],
  ): Promise<DiscordPartialGuild[]> {
    let botServerIds: Set<string>;
    try {
      botServerIds = await this.discord.fetchBotGuildIds();
    } catch (error) {
      this.logger.warn(`Could not list the bot's servers: ${String(error)}`);
      return [];
    }
    const results = await Promise.all(
      userServers
        .filter((server) => botServerIds.has(server.id))
        .map(async (server) => ((await this.hasAdminRole(accessToken, server.id)) ? server : null)),
    );
    return results.filter((server): server is DiscordPartialGuild => server !== null);
  }

  private async hasAdminRole(accessToken: string, discordServerId: string): Promise<boolean> {
    try {
      const [member, roles] = await Promise.all([
        this.discord.fetchGuildMember(accessToken, discordServerId),
        this.discord.fetchGuildRoles(discordServerId),
      ]);
      const adminRole = roles.find((role) => role.name === APP_CONFIG.adminRoleName);
      return adminRole !== undefined && member.roles.includes(adminRole.id);
    } catch (error) {
      this.logger.warn(
        `Could not check ${APP_CONFIG.adminRoleName} role in server ${discordServerId}: ${String(error)}`,
      );
      return false;
    }
  }

  async findUserBySessionToken(token: string): Promise<SessionUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) {
      return null;
    }
    const { id, discordId, username, avatar } = session.user;
    return { id, discordId, username, avatar };
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}
