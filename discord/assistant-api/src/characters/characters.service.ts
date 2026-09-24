import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { DiscordOAuthService } from '../auth/discord-oauth.service';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { CharacterName } from './character-name';

export interface DiscordNames {
  username?: string;
  displayName?: string | null;
}

export interface CharacterOwner extends DiscordNames {
  discordServerId: string;
  discordUserId: string;
}

export interface NewCharacter extends CharacterName {
  class: string;
  roles: Role[];
  isMain: boolean;
  level?: number;
}

export type CharacterUpdate = Partial<
  Pick<NewCharacter, 'class' | 'roles' | 'isMain' | 'level' | 'firstName' | 'lastName'>
>;

interface GuildRef {
  id: string;
}

export interface CharacterSummary extends CharacterName {
  class: string;
  roles: Role[];
  isMain: boolean;
  level: number;
}

@Injectable()
export class CharactersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly discord: DiscordOAuthService,
  ) {}

  /**
   * Adds a character for the user, registering them as a player of the
   * guild managed by this Discord server on first use.
   */
  async add(
    owner: CharacterOwner,
    character: NewCharacter,
  ): Promise<'created' | 'duplicate' | 'no-guild'> {
    const guild = await this.findGuild(owner.discordServerId);
    if (!guild) {
      return 'no-guild';
    }
    return this.createForPlayer(guild, owner.discordUserId, character, owner);
  }

  /** Same as `add`, addressed by guild id (used by the backoffice). */
  async addToGuild(
    guildId: string,
    discordUserId: string,
    character: NewCharacter,
    names?: DiscordNames,
  ): Promise<'created' | 'duplicate' | 'no-guild'> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { id: true },
    });
    if (!guild) {
      return 'no-guild';
    }
    return this.createForPlayer(guild, discordUserId, character, names);
  }

  /**
   * Discord names of the user if they are a member of at least one of the
   * guild's Discord servers, otherwise null.
   */
  async findGuildMemberNames(
    guildId: string,
    discordUserId: string,
  ): Promise<Required<DiscordNames> | null> {
    const servers = await this.prisma.discordServer.findMany({
      where: { guildId },
      select: { discordId: true },
    });
    const lookups = await Promise.allSettled(
      servers.map((server) => this.discord.fetchServerMember(server.discordId, discordUserId)),
    );
    for (const lookup of lookups) {
      if (lookup.status === 'fulfilled') {
        const { nick, user } = lookup.value;
        return { username: user.username, displayName: nick ?? user.global_name };
      }
    }
    return null;
  }

  async update(characterId: string, patch: CharacterUpdate): Promise<void> {
    const { player } = await this.prisma.character.update({
      where: { id: characterId },
      data: patch,
      select: { player: { select: { guildId: true } } },
    });
    this.realtime.publish(player.guildId, 'characters');
  }

  async removeById(characterId: string): Promise<void> {
    const { player } = await this.prisma.character.delete({
      where: { id: characterId },
      select: { player: { select: { guildId: true } } },
    });
    this.realtime.publish(player.guildId, 'characters');
  }

  async findGuildIdOfCharacter(characterId: string): Promise<string> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { player: { select: { guildId: true } } },
    });
    if (!character) {
      throw new NotFoundException('Character not found');
    }
    return character.player.guildId;
  }

  private async createForPlayer(
    guild: GuildRef,
    discordUserId: string,
    character: NewCharacter,
    names?: DiscordNames,
  ): Promise<'created' | 'duplicate'> {
    const player = await this.prisma.player.upsert({
      where: { guildId_discordUserId: { guildId: guild.id, discordUserId } },
      create: {
        guildId: guild.id,
        discordUserId,
        discordUsername: names?.username,
        discordDisplayName: names?.displayName,
      },
      update: {
        discordUsername: names?.username,
        discordDisplayName: names?.displayName,
      },
    });

    try {
      await this.prisma.character.create({
        data: {
          playerId: player.id,
          class: character.class,
          roles: character.roles,
          firstName: character.firstName,
          lastName: character.lastName,
          isMain: character.isMain,
          level: character.level,
        },
      });
      this.realtime.publish(guild.id, 'characters');
      return 'created';
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'duplicate';
      }
      throw error;
    }
  }

  /** Returns null if this Discord server isn't linked to a guild. */
  async list(owner: CharacterOwner): Promise<CharacterSummary[] | null> {
    const guild = await this.findGuild(owner.discordServerId);
    if (!guild) {
      return null;
    }
    return this.prisma.character.findMany({
      where: { player: { guildId: guild.id, discordUserId: owner.discordUserId } },
      orderBy: [{ isMain: 'desc' }, { firstName: 'asc' }],
      select: {
        firstName: true,
        lastName: true,
        class: true,
        roles: true,
        isMain: true,
        level: true,
      },
    });
  }

  async remove(
    owner: CharacterOwner,
    name: CharacterName,
  ): Promise<'removed' | 'not-found' | 'no-guild'> {
    const guild = await this.findGuild(owner.discordServerId);
    if (!guild) {
      return 'no-guild';
    }
    const { count } = await this.prisma.character.deleteMany({
      where: {
        firstName: name.firstName,
        lastName: name.lastName,
        player: { guildId: guild.id, discordUserId: owner.discordUserId },
      },
    });
    if (count === 0) {
      return 'not-found';
    }
    this.realtime.publish(guild.id, 'characters');
    return 'removed';
  }

  private findGuild(discordServerId: string) {
    return this.prisma.guild.findFirst({
      where: { servers: { some: { discordId: discordServerId } } },
      select: { id: true },
    });
  }
}
