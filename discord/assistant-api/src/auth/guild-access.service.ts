import { ForbiddenException, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class GuildAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAdmin(userId: string, guildId: string): Promise<void> {
    const membership = await this.prisma.guildMember.findUnique({
      where: { userId_guildId: { userId, guildId } },
      select: { isAdmin: true },
    });
    if (!membership?.isAdmin) {
      throw new ForbiddenException(`Requires the ${APP_CONFIG.adminRoleName} role`);
    }
  }
}
