import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PlayerDto } from './dto/player.dto';

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Players in guilds the given backoffice user belongs to. */
  findForUser(userId: string): Promise<PlayerDto[]> {
    return this.findMany({ guild: { access: { some: { userId } } } });
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
