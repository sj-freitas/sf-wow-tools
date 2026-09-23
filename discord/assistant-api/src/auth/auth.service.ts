import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { SessionUser } from './auth.types';
import { DiscordOAuthService } from './discord-oauth.service';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
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

    const trackedGuilds = await this.prisma.guild.findMany({
      where: { servers: { some: { discordId: { in: discordGuilds.map((guild) => guild.id) } } } },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.guildMember.deleteMany({ where: { userId: user.id } }),
      this.prisma.guildMember.createMany({
        data: trackedGuilds.map((guild) => ({ userId: user.id, guildId: guild.id })),
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
