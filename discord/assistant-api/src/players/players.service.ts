import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PlayerDto } from './dto/player.dto';

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PlayerDto[]> {
    return this.prisma.player.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        realm: true,
        class: true,
        level: true,
        faction: true,
        guildId: true,
      },
    });
  }
}
