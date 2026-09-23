import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { CharacterName } from './character-name';

export interface CharacterOwner {
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
  constructor(private readonly prisma: PrismaService) {}

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
    return this.createForPlayer(guild, owner.discordUserId, character);
  }

  /** Same as `add`, addressed by guild id (used by the backoffice). */
  async addToGuild(
    guildId: string,
    discordUserId: string,
    character: NewCharacter,
  ): Promise<'created' | 'duplicate' | 'no-guild'> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { id: true },
    });
    if (!guild) {
      return 'no-guild';
    }
    return this.createForPlayer(guild, discordUserId, character);
  }

  async update(characterId: string, patch: CharacterUpdate): Promise<void> {
    await this.prisma.character.update({ where: { id: characterId }, data: patch });
  }

  async removeById(characterId: string): Promise<void> {
    await this.prisma.character.delete({ where: { id: characterId } });
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
  ): Promise<'created' | 'duplicate'> {
    const player = await this.prisma.player.upsert({
      where: { guildId_discordUserId: { guildId: guild.id, discordUserId } },
      create: { guildId: guild.id, discordUserId },
      update: {},
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
    return count > 0 ? 'removed' : 'not-found';
  }

  private findGuild(discordServerId: string) {
    return this.prisma.guild.findFirst({
      where: { servers: { some: { discordId: discordServerId } } },
      select: { id: true },
    });
  }
}
