import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';
import { GAME_VERSIONS } from '../game/game-version';
import { RealtimeService } from '../realtime/realtime.service';

export interface GuildServerDto {
  discordId: string;
  name: string;
}

export interface UserGuildDto {
  id: string;
  name: string;
  realm: string;
  faction: 'ALLIANCE' | 'HORDE';
  gameVersion: string;
  isAdmin: boolean;
  servers: GuildServerDto[];
}

export interface EligibleServersDto {
  servers: GuildServerDto[];
}

export interface SetupInfoDto {
  adminRoleName: string;
  botInviteUrl: string;
}

export interface CreateGuildInput {
  name: string;
  realm: string;
  faction: 'ALLIANCE' | 'HORDE';
  gameVersion: string;
  discordServerIds: string[];
}

const guildSelect = {
  id: true,
  name: true,
  realm: true,
  faction: true,
  gameVersion: true,
  servers: { select: { discordId: true, name: true }, orderBy: { name: 'asc' } },
} satisfies Prisma.GuildSelect;

@Injectable()
export class GuildsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async findForUser(userId: string): Promise<UserGuildDto[]> {
    const memberships = await this.prisma.guildAccess.findMany({
      where: { userId },
      orderBy: { guild: { name: 'asc' } },
      select: { isAdmin: true, guild: { select: guildSelect } },
    });
    return memberships.map(({ isAdmin, guild }) => ({ ...guild, isAdmin }));
  }

  /** Servers where the user holds the admin role and that don't belong to a guild yet. */
  async findEligibleServers(userId: string): Promise<EligibleServersDto> {
    const servers = await this.prisma.userAdminServer.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    const taken = await this.prisma.discordServer.findMany({
      where: { discordId: { in: servers.map((server) => server.discordId) } },
      select: { discordId: true },
    });
    const takenIds = new Set(taken.map((server) => server.discordId));
    return {
      servers: servers
        .filter((server) => !takenIds.has(server.discordId))
        .map(({ discordId, name }) => ({ discordId, name })),
    };
  }

  async create(userId: string, input: CreateGuildInput): Promise<UserGuildDto> {
    const eligible = await this.findEligibleServers(userId);
    const eligibleById = new Map(eligible.servers.map((server) => [server.discordId, server]));
    const chosen = input.discordServerIds.map((id) => eligibleById.get(id));
    if (chosen.some((server) => server === undefined)) {
      throw new BadRequestException(
        `You can only pick servers where you hold the ${APP_CONFIG.adminRoleName} role and that have no guild yet`,
      );
    }

    try {
      const guild = await this.prisma.guild.create({
        data: {
          name: input.name,
          realm: input.realm,
          faction: input.faction,
          gameVersion: input.gameVersion,
          servers: { create: chosen.map((server) => ({ ...server! })) },
          access: { create: { userId, isAdmin: true } },
        },
        select: guildSelect,
      });
      return { ...guild, isAdmin: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'A guild with this name, realm and game version already exists, or a server is already taken',
        );
      }
      throw error;
    }
  }

  /** A guild must keep at least one server, otherwise nobody could reach it. */
  async removeServer(guildId: string, discordServerId: string): Promise<void> {
    const servers = await this.prisma.discordServer.findMany({
      where: { guildId },
      select: { discordId: true },
    });
    if (!servers.some((server) => server.discordId === discordServerId)) {
      throw new NotFoundException('Server is not part of this guild');
    }
    if (servers.length === 1) {
      throw new BadRequestException('A guild needs at least one Discord server');
    }
    await this.prisma.discordServer.delete({ where: { discordId: discordServerId } });
    this.realtime.publish(guildId, 'guild');
  }
}

export const isGameVersion = (value: unknown): value is string =>
  typeof value === 'string' && (GAME_VERSIONS as readonly string[]).includes(value);
