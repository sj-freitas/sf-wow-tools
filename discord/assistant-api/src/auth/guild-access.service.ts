import { ForbiddenException, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';
import { canConfigureGuild, canManageAllCharacters } from './access-rules';

@Injectable()
export class GuildAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Guild-Assistant or Officer: configuration of the guild itself. */
  async assertCanConfigure(userId: string, guildId: string): Promise<void> {
    const access = await this.find(userId, guildId);
    if (!access || !canConfigureGuild(access)) {
      throw new ForbiddenException(
        `Requires the ${APP_CONFIG.adminRoleName} role or the guild's Officer role`,
      );
    }
  }

  /** Officer of the guild: manages every player's characters. */
  async assertOfficer(userId: string, guildId: string): Promise<void> {
    const access = await this.find(userId, guildId);
    if (!access || !canManageAllCharacters(access)) {
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
