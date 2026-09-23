import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionUser } from './auth.types';
import { DiscordOAuthService } from './discord-oauth.service';

export const ADMIN_ROLE_NAME = 'Guild-Assistant';

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

    const userServerIds = new Set(discordGuilds.map((guild) => guild.id));
    const guilds = await this.prisma.guild.findMany({
      where: { servers: { some: { discordId: { in: [...userServerIds] } } } },
      select: { id: true, servers: { select: { discordId: true } } },
    });
    const adminGuildIds = await this.findAdminGuildIds(accessToken, guilds, userServerIds);
    await this.prisma.$transaction([
      this.prisma.guildMember.deleteMany({ where: { userId: user.id } }),
      this.prisma.guildMember.createMany({
        data: guilds.map((guild) => ({
          userId: user.id,
          guildId: guild.id,
          isAdmin: adminGuildIds.has(guild.id),
        })),
      }),
    ]);

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
   * Guilds where the user holds the ADMIN_ROLE_NAME role in *every* Discord
   * server the guild is associated with (a server they're not in counts as no).
   */
  private async findAdminGuildIds(
    accessToken: string,
    guilds: { id: string; servers: { discordId: string }[] }[],
    userServerIds: Set<string>,
  ): Promise<Set<string>> {
    const results = await Promise.all(
      guilds.map(async (guild) => {
        const hasRole = await Promise.all(
          guild.servers.map(
            async (server) =>
              userServerIds.has(server.discordId) &&
              (await this.hasAdminRole(accessToken, server.discordId)),
          ),
        );
        return hasRole.every(Boolean) ? guild.id : null;
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
      const adminRole = roles.find((role) => role.name === ADMIN_ROLE_NAME);
      return adminRole !== undefined && member.roles.includes(adminRole.id);
    } catch (error) {
      this.logger.warn(
        `Could not check ${ADMIN_ROLE_NAME} role in server ${discordServerId}: ${String(error)}`,
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
