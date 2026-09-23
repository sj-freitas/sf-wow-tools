import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../database/prisma.service';

export interface UserGuildDto {
  id: string;
  name: string;
  realm: string;
  faction: 'ALLIANCE' | 'HORDE';
  gameVersion: string;
  isAdmin: boolean;
}

@Controller('guilds')
@UseGuards(AuthGuard)
export class GuildsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Guilds the logged-in user belongs to, with whether they can manage them. */
  async findMine(userId: string): Promise<UserGuildDto[]> {
    const memberships = await this.prisma.guildMember.findMany({
      where: { userId },
      orderBy: { guild: { name: 'asc' } },
      select: {
        isAdmin: true,
        guild: {
          select: { id: true, name: true, realm: true, faction: true, gameVersion: true },
        },
      },
    });
    return memberships.map(({ isAdmin, guild }) => ({ ...guild, isAdmin }));
  }

  @Get()
  list(@Req() req: AuthenticatedRequest): Promise<UserGuildDto[]> {
    return this.findMine(req.user.id);
  }
}
