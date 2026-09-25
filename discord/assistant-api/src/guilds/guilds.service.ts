import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DiscordOAuthService, type DiscordServerMember } from '../auth/discord-oauth.service';
import { APP_CONFIG } from '../config/app.config';
import type { RegionId } from '../config/regions';
import { sniffImageType } from './banner';
import { PrismaService } from '../database/prisma.service';
import { GAME_VERSIONS } from '../game/game-version';
import { guildPath } from './guild-path';
import { RealtimeService } from '../realtime/realtime.service';

export type Faction = 'ALLIANCE' | 'HORDE';

export interface GuildServerDto {
  discordId: string;
  name: string;
  /** Discord icon hash, for the picture next to the guild name. */
  icon: string | null;
  isMain: boolean;
}

export interface UserGuildDto {
  id: string;
  /** Where the guild lives in the backoffice: `<version>/<region>/<server>/<guild-name>`. */
  path: string;
  name: string;
  realm: string;
  faction: Faction;
  gameVersion: string;
  region: string;
  servers: GuildServerDto[];
  /** Changes whenever the optional banner image does; null when there is none. */
  bannerVersion: number | null;
  officerRole: { id: string; name: string } | null;
  /** Where members' messages to the officers are posted; null until set. */
  officerRequestChannel: { serverId: string; channelId: string } | null;
  /** Optional Discord roles (in the main server) standing for Raider and Social, for roster setup. */
  roleMappings: RoleMappingsDto;
  /** Holds Guild-Assistant in every server: configures the guild (details, servers, Officer role). */
  isAdmin: boolean;
  /** Holds the Officer role in the main server: manages every player's characters. */
  isOfficer: boolean;
}

export type GuildRoleKey = 'RAIDER' | 'SOCIAL';
export const GUILD_ROLE_KEYS: readonly GuildRoleKey[] = ['RAIDER', 'SOCIAL'];

export type RoleMappingsDto = Record<GuildRoleKey, { id: string; name: string } | null>;

export interface GuildHomeDto {
  /** The welcome post in markdown, or null when none has been written. */
  markdown: string | null;
  updatedAt: string | null;
  /** Username of the Officer who last edited it. */
  updatedBy: string | null;
}

/** Longest welcome post, in characters. */
export const MAX_HOME_LENGTH = 10_000;

export interface EligibleServersDto {
  servers: { discordId: string; name: string }[];
}

export interface SetupInfoDto {
  adminRoleName: string;
  botInviteUrl: string;
  /** Regions a guild can be in, with the timezone their schedules run in. */
  regions: { id: string; label: string; timezone: string }[];
}

export interface RoleOptionDto {
  id: string;
  name: string;
}

export interface PeopleDto {
  /**
   * `servers`: everyone in the guild's Discord servers. `known`: Discord refused to
   * list server members (Server Members intent off), so only players we know.
   */
  source: 'servers' | 'known';
  people: PersonDto[];
}

export interface PersonDto {
  discordUserId: string;
  username: string | null;
  displayName: string | null;
  characterNames: string[];
}

export interface CreateGuildInput extends GuildDetails {
  discordServerIds: string[];
  mainServerId: string;
}

export interface GuildDetails {
  name: string;
  realm: string;
  faction: Faction;
  gameVersion: string;
  region: RegionId;
}

const guildSelect = {
  id: true,
  name: true,
  realm: true,
  faction: true,
  gameVersion: true,
  region: true,
  officerRoleId: true,
  officerRoleName: true,
  officerRequestServerId: true,
  officerRequestChannelId: true,
  servers: {
    select: { discordId: true, name: true, icon: true, isMain: true },
    orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
  },
  roleMappings: { select: { guildRole: true, discordRoleId: true, discordRoleName: true } },
  banner: { select: { updatedAt: true } },
} satisfies Prisma.GuildSelect;

type GuildRow = Prisma.GuildGetPayload<{ select: typeof guildSelect }>;

function toDto(guild: GuildRow, isAdmin: boolean, isOfficer: boolean): UserGuildDto {
  const {
    officerRoleId,
    officerRoleName,
    officerRequestServerId,
    officerRequestChannelId,
    roleMappings,
    banner,
    ...rest
  } = guild;
  const mapped = (key: GuildRoleKey) => {
    const mapping = roleMappings.find((m) => m.guildRole === key);
    return mapping ? { id: mapping.discordRoleId, name: mapping.discordRoleName } : null;
  };
  return {
    ...rest,
    path: guildPath(rest),
    bannerVersion: banner ? banner.updatedAt.getTime() : null,
    roleMappings: { RAIDER: mapped('RAIDER'), SOCIAL: mapped('SOCIAL') },
    officerRequestChannel:
      officerRequestServerId && officerRequestChannelId
        ? { serverId: officerRequestServerId, channelId: officerRequestChannelId }
        : null,
    officerRole:
      officerRoleId && officerRoleName ? { id: officerRoleId, name: officerRoleName } : null,
    isAdmin,
    isOfficer,
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class GuildsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly discord: DiscordOAuthService,
  ) {}

  async findForUser(userId: string): Promise<UserGuildDto[]> {
    const access = await this.prisma.guildAccess.findMany({
      where: { userId },
      orderBy: { guild: { name: 'asc' } },
      select: { isAdmin: true, isOfficer: true, guild: { select: guildSelect } },
    });
    return access.map(({ isAdmin, isOfficer, guild }) => toDto(guild, isAdmin, isOfficer));
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

  /**
   * Two guilds may not share an address. The database only stops exact duplicates, but the
   * address is lower-cased and simplified, so "Relic Hunters" and "relic-hunters" would clash.
   */
  private async assertAddressFree(details: GuildDetails, exceptGuildId?: string): Promise<void> {
    const address = guildPath(details);
    const candidates = await this.prisma.guild.findMany({
      where: { gameVersion: details.gameVersion, region: details.region },
      select: { id: true, name: true, realm: true, gameVersion: true, region: true },
    });
    if (candidates.some((other) => other.id !== exceptGuildId && guildPath(other) === address)) {
      throw new ConflictException(
        'A guild with this name already exists on that server (names are compared ignoring case and punctuation).',
      );
    }
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
    if (!input.discordServerIds.includes(input.mainServerId)) {
      throw new BadRequestException('The main server must be one of the selected servers');
    }
    await this.assertAddressFree(input);

    try {
      const guild = await this.prisma.guild.create({
        data: {
          name: input.name,
          realm: input.realm,
          faction: input.faction,
          gameVersion: input.gameVersion,
          region: input.region,
          servers: {
            create: chosen.map((server) => ({
              ...server!,
              isMain: server!.discordId === input.mainServerId,
            })),
          },
          access: { create: { userId, isAdmin: true } },
        },
        select: guildSelect,
      });
      return toDto(guild, true, false);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A guild with this name, realm and game version already exists, or a server is already taken',
        );
      }
      throw error;
    }
  }

  async update(guildId: string, details: Partial<GuildDetails>): Promise<void> {
    const current = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { name: true, realm: true, gameVersion: true, region: true },
    });
    if (!current) throw new NotFoundException('Guild not found');
    await this.assertAddressFree({ ...current, ...details } as GuildDetails, guildId);
    try {
      await this.prisma.guild.update({ where: { id: guildId }, data: details });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'A guild with this name, realm and game version already exists',
        );
      }
      throw error;
    }
    this.realtime.publish(guildId, 'guild');
  }

  async delete(guildId: string): Promise<void> {
    // Access rows disappear with the guild, so remember who to notify.
    const access = await this.prisma.guildAccess.findMany({
      where: { guildId },
      select: { userId: true },
    });
    await this.prisma.guild.delete({ where: { id: guildId } });
    this.realtime.publish(
      guildId,
      'guild',
      access.map((row) => row.userId),
    );
  }

  /** Adds a server the user holds the admin role in (i.e. one that is eligible for them). */
  async addServer(userId: string, guildId: string, discordServerId: string): Promise<void> {
    const eligible = await this.findEligibleServers(userId);
    const server = eligible.servers.find((candidate) => candidate.discordId === discordServerId);
    if (!server) {
      throw new BadRequestException(
        `You can only add servers where you hold the ${APP_CONFIG.adminRoleName} role and that have no guild yet`,
      );
    }
    try {
      await this.prisma.discordServer.create({
        data: { guildId, discordId: server.discordId, name: server.name, isMain: false },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('That server already belongs to a guild');
      }
      throw error;
    }
    this.realtime.publish(guildId, 'guild');
  }

  /** A guild keeps at least one server, and its main server can't be removed directly. */
  async removeServer(guildId: string, discordServerId: string): Promise<void> {
    const servers = await this.prisma.discordServer.findMany({
      where: { guildId },
      select: { discordId: true, isMain: true },
    });
    const target = servers.find((server) => server.discordId === discordServerId);
    if (!target) {
      throw new NotFoundException('Server is not part of this guild');
    }
    if (servers.length === 1) {
      throw new BadRequestException('A guild needs at least one Discord server');
    }
    if (target.isMain) {
      throw new BadRequestException('Make another server the main one before removing this one');
    }
    await this.prisma.discordServer.delete({ where: { discordId: discordServerId } });
    this.realtime.publish(guildId, 'guild');
  }

  /** Changing the main server clears the role settings, since roles belong to a server. */
  async setMainServer(guildId: string, discordServerId: string): Promise<void> {
    const server = await this.prisma.discordServer.findFirst({
      where: { guildId, discordId: discordServerId },
      select: { id: true },
    });
    if (!server) {
      throw new NotFoundException('Server is not part of this guild');
    }
    await this.prisma.$transaction([
      this.prisma.discordServer.updateMany({ where: { guildId }, data: { isMain: false } }),
      this.prisma.discordServer.update({ where: { id: server.id }, data: { isMain: true } }),
      this.prisma.guild.update({
        where: { id: guildId },
        data: { officerRoleId: null, officerRoleName: null },
      }),
      this.prisma.guildRoleMapping.deleteMany({ where: { guildId } }),
    ]);
    this.realtime.publish(guildId, 'guild');
  }

  /** Roles of the main server, for picking the Officer role and the guild role mappings. */
  async listRoleOptions(guildId: string): Promise<RoleOptionDto[]> {
    const roles = await this.readMainServerRoles(guildId);
    return roles.sort((a, b) => a.name.localeCompare(b.name));
  }

  async setOfficerRole(guildId: string, roleId: string | null): Promise<void> {
    let data: { officerRoleId: string | null; officerRoleName: string | null } = {
      officerRoleId: null,
      officerRoleName: null,
    };
    if (roleId !== null) {
      const role = (await this.readMainServerRoles(guildId)).find((r) => r.id === roleId);
      if (!role) {
        throw new BadRequestException('That role does not exist in the main server');
      }
      data = { officerRoleId: role.id, officerRoleName: role.name };
    }
    await this.prisma.guild.update({ where: { id: guildId }, data });
    this.realtime.publish(guildId, 'guild');
  }

  /** Maps (or, with `roleId: null`, unmaps) a guild role to a role of the main server. */
  async setRoleMapping(
    guildId: string,
    guildRole: GuildRoleKey,
    roleId: string | null,
  ): Promise<void> {
    if (roleId === null) {
      await this.prisma.guildRoleMapping.deleteMany({ where: { guildId, guildRole } });
    } else {
      const role = (await this.readMainServerRoles(guildId)).find((r) => r.id === roleId);
      if (!role) {
        throw new BadRequestException('That role does not exist in the main server');
      }
      await this.prisma.guildRoleMapping.upsert({
        where: { guildId_guildRole: { guildId, guildRole } },
        create: { guildId, guildRole, discordRoleId: role.id, discordRoleName: role.name },
        update: { discordRoleId: role.id, discordRoleName: role.name },
      });
    }
    this.realtime.publish(guildId, 'guild');
  }

  /** The guild's welcome post. It is optional: `markdown` is null until an Officer writes one. */
  async getHome(guildId: string): Promise<GuildHomeDto> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { homeMarkdown: true, homeUpdatedAt: true, homeUpdatedById: true },
    });
    if (!guild) throw new NotFoundException('Guild not found');
    const editor = guild.homeUpdatedById
      ? await this.prisma.user.findUnique({
          where: { id: guild.homeUpdatedById },
          select: { username: true, displayName: true },
        })
      : null;
    return {
      markdown: guild.homeMarkdown,
      updatedAt: guild.homeUpdatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.displayName ?? editor.username) : null,
    };
  }

  /** Saves the welcome post; an empty text removes it. */
  async setHome(guildId: string, userId: string, markdown: unknown): Promise<GuildHomeDto> {
    if (typeof markdown !== 'string') {
      throw new BadRequestException('markdown must be text');
    }
    const text = markdown.trim();
    if (text.length > MAX_HOME_LENGTH) {
      throw new BadRequestException(
        `The welcome post can have at most ${MAX_HOME_LENGTH} characters.`,
      );
    }
    await this.prisma.guild.update({
      where: { id: guildId },
      data: {
        homeMarkdown: text === '' ? null : text,
        homeUpdatedAt: new Date(),
        homeUpdatedById: userId,
      },
    });
    return this.getHome(guildId);
  }

  async getBanner(guildId: string): Promise<{ contentType: string; data: Buffer } | null> {
    const banner = await this.prisma.guildBanner.findUnique({ where: { guildId } });
    return banner ? { contentType: banner.contentType, data: Buffer.from(banner.data) } : null;
  }

  /** Saves the banner (replacing any earlier one) after checking it really is an image. */
  async setBanner(guildId: string, data: Buffer): Promise<void> {
    if (data.length === 0) throw new BadRequestException('No image was sent.');
    const contentType = sniffImageType(data);
    if (!contentType) {
      throw new BadRequestException('The banner must be a PNG, JPEG, GIF or WebP image.');
    }
    const bytes = new Uint8Array(data);
    await this.prisma.guildBanner.upsert({
      where: { guildId },
      create: { guildId, contentType, data: bytes },
      update: { contentType, data: bytes },
    });
    this.realtime.publish(guildId, 'guild');
  }

  async removeBanner(guildId: string): Promise<void> {
    await this.prisma.guildBanner.deleteMany({ where: { guildId } });
    this.realtime.publish(guildId, 'guild');
  }

  /** People the "add character" search can offer: members of the guild's Discord servers. */
  async findPeople(guildId: string): Promise<PeopleDto> {
    const [players, servers] = await Promise.all([
      this.prisma.player.findMany({
        where: { guildId },
        select: {
          discordUserId: true,
          discordUsername: true,
          discordDisplayName: true,
          characters: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.discordServer.findMany({ where: { guildId }, select: { discordId: true } }),
    ]);
    const characterNames = new Map(
      players.map((player) => [
        player.discordUserId,
        player.characters.map((c) => `${c.firstName} ${c.lastName}`.trim()),
      ]),
    );

    const lists = await Promise.allSettled(
      servers.map((server) => this.discord.fetchServerMembers(server.discordId)),
    );
    const fulfilled = lists.filter(
      (list): list is PromiseFulfilledResult<DiscordServerMember[]> => list.status === 'fulfilled',
    );

    if (fulfilled.length > 0) {
      const people = new Map<string, PersonDto>();
      for (const { value } of fulfilled) {
        for (const { nick, user } of value) {
          people.set(user.id, {
            discordUserId: user.id,
            username: user.username,
            displayName: nick ?? user.global_name,
            characterNames: characterNames.get(user.id) ?? [],
          });
        }
      }
      return { source: 'servers', people: [...people.values()] };
    }

    return {
      source: 'known',
      people: players.map((player) => ({
        discordUserId: player.discordUserId,
        username: player.discordUsername,
        displayName: player.discordDisplayName,
        characterNames: characterNames.get(player.discordUserId) ?? [],
      })),
    };
  }

  private async readMainServerRoles(guildId: string): Promise<RoleOptionDto[]> {
    const main = await this.prisma.discordServer.findFirst({
      where: { guildId, isMain: true },
      select: { discordId: true },
    });
    if (!main) {
      throw new NotFoundException('The guild has no main server');
    }
    try {
      const roles = await this.discord.fetchGuildRoles(main.discordId);
      return roles
        .filter((role) => role.id !== main.discordId) // @everyone shares the server's id
        .map(({ id, name }) => ({ id, name }));
    } catch {
      throw new BadRequestException(
        "Could not read the main server's roles. Is the bot in that server?",
      );
    }
  }
}

export const isGameVersion = (value: unknown): value is string =>
  typeof value === 'string' && (GAME_VERSIONS as readonly string[]).includes(value);
