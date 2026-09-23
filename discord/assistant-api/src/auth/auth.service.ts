import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';
import type { SessionUser } from './auth.types';
import { DiscordOAuthService, type DiscordPartialGuild } from './discord-oauth.service';
import { TokenCrypto } from './token-crypto';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const REAUTH_MESSAGE = 'Your Discord authorization expired. Please log out and log in again.';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly crypto: TokenCrypto;
  /** One Discord sync per user at a time (parallel requests share it). */
  private readonly inFlightSyncs = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordOAuthService,
    configService: ConfigService,
  ) {
    this.crypto = new TokenCrypto(configService.getOrThrow<string>('SESSION_ENCRYPTION_KEY'));
  }

  /** Completes the OAuth flow: upserts the user, syncs their Discord data, opens a session. */
  async loginWithCode(code: string): Promise<string> {
    const { accessToken, expiresIn } = await this.discord.exchangeCode(code);
    const discordUser = await this.discord.fetchUser(accessToken);

    const user = await this.prisma.user.upsert({
      where: { discordId: discordUser.id },
      create: {
        discordId: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar,
      },
      update: { username: discordUser.username, avatar: discordUser.avatar },
    });
    await this.syncFromDiscord(user.id, accessToken);

    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        discordAccessToken: this.crypto.encrypt(accessToken),
        discordTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      },
    });
    return token;
  }

  /**
   * Re-reads the user's servers and roles from Discord using the token stored
   * with their session, unless it was synced recently (and `force` is false).
   * Throws Unauthorized if the stored Discord token is missing or rejected.
   */
  async refresh(sessionToken: string, { force }: { force: boolean }): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(sessionToken) },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Not logged in');
    }
    if (!force && Date.now() - session.discordSyncedAt.getTime() < APP_CONFIG.discordSyncMaxAgeMs) {
      return;
    }
    if (
      !session.discordAccessToken ||
      (session.discordTokenExpiresAt && session.discordTokenExpiresAt < new Date())
    ) {
      throw new UnauthorizedException(REAUTH_MESSAGE);
    }

    let sync = this.inFlightSyncs.get(session.userId);
    if (!sync) {
      const accessToken = this.crypto.decrypt(session.discordAccessToken);
      sync = this.syncFromDiscord(session.userId, accessToken)
        .catch(() => {
          throw new UnauthorizedException(REAUTH_MESSAGE);
        })
        .finally(() => this.inFlightSyncs.delete(session.userId));
      this.inFlightSyncs.set(session.userId, sync);
    }
    await sync;
    await this.prisma.session.update({
      where: { id: session.id },
      data: { discordSyncedAt: new Date() },
    });
  }

  /** Best-effort refresh for ordinary requests; failures only delay the next attempt. */
  async refreshIfStale(sessionToken: string): Promise<void> {
    try {
      await this.refresh(sessionToken, { force: false });
    } catch (error) {
      this.logger.warn(`Discord re-sync failed: ${String(error)}`);
      await this.prisma.session.updateMany({
        where: { tokenHash: hashToken(sessionToken) },
        data: { discordSyncedAt: new Date() },
      });
    }
  }

  private async syncFromDiscord(userId: string, accessToken: string): Promise<void> {
    const discordGuilds = await this.discord.fetchGuilds(accessToken);
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
      this.prisma.guildAccess.deleteMany({ where: { userId } }),
      this.prisma.guildAccess.createMany({
        data: guilds.map((guild) => ({
          userId,
          guildId: guild.id,
          isAdmin: adminGuildIds.has(guild.id),
        })),
      }),
      this.prisma.userAdminServer.deleteMany({ where: { userId } }),
      this.prisma.userAdminServer.createMany({
        data: adminServers.map((server) => ({
          userId,
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
