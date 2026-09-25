import { createHash, randomBytes } from 'node:crypto';
import { BadGatewayException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';
import type { SessionUser } from './auth.types';
import {
  DiscordApiError,
  DiscordOAuthService,
  type DiscordPartialGuild,
} from './discord-oauth.service';
import { holdsRoleNamed, isGuildAssistant } from './access-rules';
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
        displayName: discordUser.global_name,
        avatar: discordUser.avatar,
      },
      update: {
        username: discordUser.username,
        displayName: discordUser.global_name,
        avatar: discordUser.avatar,
      },
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
    const maxAge = force
      ? APP_CONFIG.discordForceSyncMinIntervalMs
      : APP_CONFIG.discordSyncMaxAgeMs;
    if (Date.now() - session.discordSyncedAt.getTime() < maxAge) {
      return;
    }
    if (
      !session.discordAccessToken ||
      (session.discordTokenExpiresAt && session.discordTokenExpiresAt < new Date())
    ) {
      await this.endSession(session.id);
      throw new UnauthorizedException(REAUTH_MESSAGE);
    }

    let sync = this.inFlightSyncs.get(session.userId);
    if (!sync) {
      const accessToken = this.crypto.decrypt(session.discordAccessToken);
      sync = this.syncFromDiscord(session.userId, accessToken).finally(() =>
        this.inFlightSyncs.delete(session.userId),
      );
      this.inFlightSyncs.set(session.userId, sync);
    }
    try {
      await sync;
    } catch (error) {
      if (error instanceof DiscordApiError && error.discordStatus === 401) {
        // Discord no longer accepts the token: end the session so the user logs in again.
        await this.endSession(session.id);
        throw new UnauthorizedException(REAUTH_MESSAGE);
      }
      throw new BadGatewayException('Could not reach Discord. Try again in a moment.');
    }
    await this.prisma.session.update({
      where: { id: session.id },
      data: { discordSyncedAt: new Date() },
    });
  }

  /**
   * Refresh for ordinary requests. If the session can no longer be used (Discord
   * token expired or revoked) this throws Unauthorized so the caller must log in
   * again; other failures only delay the next attempt.
   */
  async refreshIfStale(sessionToken: string): Promise<void> {
    try {
      await this.refresh(sessionToken, { force: false });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.warn(`Discord re-sync failed: ${String(error)}`);
      await this.prisma.session.updateMany({
        where: { tokenHash: hashToken(sessionToken) },
        data: { discordSyncedAt: new Date() },
      });
    }
  }

  private async endSession(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  private async syncFromDiscord(userId: string, accessToken: string): Promise<void> {
    const discordGuilds = await this.discord.fetchGuilds(accessToken);
    const adminServers = await this.findAdminServers(accessToken, discordGuilds);
    const adminServerIds = new Set(adminServers.map((server) => server.id));
    const userServerIds = discordGuilds.map((guild) => guild.id);

    const guilds = await this.prisma.guild.findMany({
      where: { servers: { some: { discordId: { in: userServerIds } } } },
      select: {
        id: true,
        officerRoleId: true,
        servers: { select: { discordId: true, isMain: true } },
      },
    });
    const adminGuildIds = new Set(
      guilds
        .filter((guild) =>
          isGuildAssistant(
            guild.servers.map((server) => server.discordId),
            adminServerIds,
          ),
        )
        .map((guild) => guild.id),
    );

    const officerGuildIds = await this.findOfficerGuildIds(
      accessToken,
      guilds,
      new Set(userServerIds),
    );

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { discordId: true, username: true },
    });

    await this.prisma.$transaction([
      // Keep the user's own player rows labelled with their current Discord username.
      this.prisma.player.updateMany({
        where: { discordUserId: user.discordId },
        data: { discordUsername: user.username },
      }),
      this.prisma.guildAccess.deleteMany({ where: { userId } }),
      this.prisma.guildAccess.createMany({
        data: guilds.map((guild) => ({
          userId,
          guildId: guild.id,
          isAdmin: adminGuildIds.has(guild.id),
          isOfficer: officerGuildIds.has(guild.id),
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

  /** Guilds where the user holds the guild's officer role in its main server. */
  private async findOfficerGuildIds(
    accessToken: string,
    guilds: {
      id: string;
      officerRoleId: string | null;
      servers: { discordId: string; isMain: boolean }[];
    }[],
    userServerIds: Set<string>,
  ): Promise<Set<string>> {
    const results = await Promise.all(
      guilds.map(async (guild) => {
        const main = guild.servers.find((server) => server.isMain);
        if (!guild.officerRoleId || !main || !userServerIds.has(main.discordId)) {
          return null;
        }
        try {
          const member = await this.discord.fetchGuildMember(accessToken, main.discordId);
          return member.roles.includes(guild.officerRoleId) ? guild.id : null;
        } catch (error) {
          this.logger.warn(
            `Could not check officer role in server ${main.discordId}: ${String(error)}`,
          );
          return null;
        }
      }),
    );
    return new Set(results.filter((guildId): guildId is string => guildId !== null));
  }

  private async hasAdminRole(accessToken: string, discordServerId: string): Promise<boolean> {
    try {
      const [member, roles] = await Promise.all([
        this.discord.fetchGuildMember(accessToken, discordServerId),
        this.discord.fetchGuildRoles(discordServerId),
      ]);
      return holdsRoleNamed(roles, member.roles, APP_CONFIG.adminRoleName);
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
    const { id, discordId, username, displayName, avatar } = session.user;
    return { id, discordId, username, displayName: displayName ?? username, avatar };
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}
