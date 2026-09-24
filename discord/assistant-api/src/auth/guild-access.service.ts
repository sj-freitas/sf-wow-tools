import { ForbiddenException, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class GuildAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Guild-Assistant only: configuration of who can manage the guild. */
  async assertAdmin(userId: string, guildId: string): Promise<void> {
    const access = await this.find(userId, guildId);
    if (!access?.isAdmin) {
      throw new ForbiddenException(`Requires the ${APP_CONFIG.adminRoleName} role`);
    }
  }

  /** Officer of the guild: manages every player's characters. */
  async assertOfficer(userId: string, guildId: string): Promise<void> {
    const access = await this.find(userId, guildId);
    if (!access?.isOfficer) {
      throw new ForbiddenException("Requires the guild's Officer role");
    }
  }

  /** Whether the user is in one of the guild's Discord servers, and whether they're an Officer. */
  find(userId: string, guildId: string) {
    return this.prisma.guildAccess.findUnique({
      where: { userId_guildId: { userId, guildId } },
      select: { isAdmin: true, isOfficer: true },
    });
  }
}
