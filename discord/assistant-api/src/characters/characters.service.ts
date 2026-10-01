import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Faction, type Role } from '@prisma/client';
import { DiscordOAuthService } from '../auth/discord-oauth.service';
import { PrismaService } from '../database/prisma.service';
import {
  classesOfRace,
  getGame,
  lastNameRequiredMessage,
  raceInFaction,
  requiresLastName,
  rolesOfClass,
} from '../game/games';
import { ROLE_LABELS } from './role-labels';
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
  /** Empty means unknown (a path that does not collect it, like the Discord command). */
  race: string;
  roles: Role[];
  isMain: boolean;
  level?: number;
}

export type CharacterUpdate = Partial<
  Pick<NewCharacter, 'class' | 'race' | 'roles' | 'isMain' | 'level' | 'firstName' | 'lastName'>
>;

interface GuildRef {
  id: string;
  gameVersion: string;
  faction: Faction;
}

export type AddResult =
  | 'created'
  | 'duplicate'
  | 'no-guild'
  | 'last-name-required'
  | 'unknown-class'
  | 'role-not-for-class'
  | 'unknown-race'
  | 'race-not-for-class';

/**
 * The roles that do not fit a class in a version (empty when they all do, or when the version says
 * nothing about the class's roles).
 */
export const rolesNotFor = (gameVersion: string, characterClass: string, roles: Role[]): Role[] => {
  const allowed = rolesOfClass(gameVersion, characterClass);
  if (allowed.length === 0) return [];
  return roles.filter((role) => !allowed.includes(ROLE_LABELS[role]));
};

/** Whether a class exists in the guild's version of the game (a version we know nothing of accepts any). */
const classInGame = (gameVersion: string, characterClass: string): boolean => {
  const game = getGame(gameVersion);
  return !game || Object.hasOwn(game.classes, characterClass);
};

export interface CharacterSummary extends CharacterName {
  class: string;
  race: string;
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
  async add(owner: CharacterOwner, character: NewCharacter): Promise<AddResult> {
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
  ): Promise<AddResult> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { id: true, gameVersion: true, faction: true },
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

  /**
   * Changes a character. With `newOwner` it moves to another Discord user of the same guild (their
   * player is created if they have none), and the previous player is removed when it is left with no
   * characters. The other player having a character with the same name is a unique violation, like a
   * rename.
   */
  async update(
    characterId: string,
    patch: CharacterUpdate,
    newOwner?: { discordUserId: string; names?: DiscordNames },
  ): Promise<void> {
    if (
      patch.firstName !== undefined ||
      patch.lastName !== undefined ||
      patch.class !== undefined ||
      patch.race !== undefined ||
      patch.roles !== undefined
    ) {
      const character = await this.prisma.character.findUnique({
        where: { id: characterId },
        select: {
          class: true,
          race: true,
          roles: true,
          player: { select: { guild: { select: { gameVersion: true, faction: true } } } },
        },
      });
      if (!character) {
        throw new NotFoundException('Character not found');
      }
      const { gameVersion, faction } = character.player.guild;
      if (
        (patch.firstName !== undefined || patch.lastName !== undefined) &&
        requiresLastName(gameVersion) &&
        !patch.lastName
      ) {
        throw new BadRequestException(lastNameRequiredMessage(gameVersion));
      }
      if (patch.class !== undefined && !classInGame(gameVersion, patch.class)) {
        throw new BadRequestException(`${gameVersion} has no ${patch.class} class.`);
      }
      if (
        patch.race !== undefined &&
        patch.race !== '' &&
        !raceInFaction(gameVersion, faction, patch.race)
      ) {
        throw new BadRequestException(`${gameVersion} has no ${patch.race} race for this faction.`);
      }
      // Changing either the class or the roles: the roles must still fit the class.
      if (patch.class !== undefined || patch.roles !== undefined) {
        const characterClass = patch.class ?? character.class;
        const misfits = rolesNotFor(gameVersion, characterClass, patch.roles ?? character.roles);
        if (misfits.length > 0) {
          throw new BadRequestException(
            `A ${characterClass} in ${gameVersion} can be ${rolesOfClass(gameVersion, characterClass).join(', ')}, not ${misfits.map((role) => ROLE_LABELS[role]).join(', ')}.`,
          );
        }
      }
      // Changing either the race or the class, with a known race: the class must still fit it.
      if (patch.race !== undefined || patch.class !== undefined) {
        const race = patch.race ?? character.race;
        const characterClass = patch.class ?? character.class;
        const allowed = race ? classesOfRace(gameVersion, faction, race) : null;
        if (allowed && !allowed.includes(characterClass)) {
          throw new BadRequestException(
            `A ${race} in ${gameVersion} can be ${allowed.join(', ')}, not ${characterClass}.`,
          );
        }
      }
    }

    let playerId: string | undefined;
    let previousPlayerId: string | undefined;
    if (newOwner) {
      const current = await this.prisma.character.findUnique({
        where: { id: characterId },
        select: { playerId: true, player: { select: { guildId: true, discordUserId: true } } },
      });
      if (!current) throw new NotFoundException('Character not found');
      if (current.player.discordUserId !== newOwner.discordUserId) {
        const { guildId } = current.player;
        const target = await this.prisma.player.upsert({
          where: { guildId_discordUserId: { guildId, discordUserId: newOwner.discordUserId } },
          create: {
            guildId,
            discordUserId: newOwner.discordUserId,
            discordUsername: newOwner.names?.username,
            discordDisplayName: newOwner.names?.displayName,
          },
          update: {
            discordUsername: newOwner.names?.username,
            discordDisplayName: newOwner.names?.displayName,
          },
        });
        playerId = target.id;
        previousPlayerId = current.playerId;
      }
    }

    const { player } = await this.prisma.character.update({
      where: { id: characterId },
      data: playerId ? { ...patch, playerId } : patch,
      select: { player: { select: { guildId: true } } },
    });
    if (previousPlayerId) {
      // A player exists only through its characters: leaving none behind is cleaned up.
      const left = await this.prisma.character.count({ where: { playerId: previousPlayerId } });
      if (left === 0) await this.prisma.player.deleteMany({ where: { id: previousPlayerId } });
    }
    this.realtime.publish(player.guildId, 'characters');
  }

  async removeById(characterId: string): Promise<void> {
    const { player } = await this.prisma.character.delete({
      where: { id: characterId },
      select: { player: { select: { guildId: true } } },
    });
    this.realtime.publish(player.guildId, 'characters');
  }

  async findOwnership(characterId: string): Promise<{ guildId: string; discordUserId: string }> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { player: { select: { guildId: true, discordUserId: true } } },
    });
    if (!character) {
      throw new NotFoundException('Character not found');
    }
    return character.player;
  }

  private async createForPlayer(
    guild: GuildRef,
    discordUserId: string,
    character: NewCharacter,
    names?: DiscordNames,
  ): Promise<Exclude<AddResult, 'no-guild'>> {
    if (requiresLastName(guild.gameVersion) && character.lastName === '') {
      return 'last-name-required';
    }
    if (!classInGame(guild.gameVersion, character.class)) return 'unknown-class';
    if (rolesNotFor(guild.gameVersion, character.class, character.roles).length > 0) {
      return 'role-not-for-class';
    }
    // Race is free-form and may be empty (a path that does not collect it, like the Discord
    // command): only check it against the guild's faction when one was given.
    if (character.race !== '') {
      if (!raceInFaction(guild.gameVersion, guild.faction, character.race)) return 'unknown-race';
      const allowed = classesOfRace(guild.gameVersion, guild.faction, character.race);
      if (allowed && !allowed.includes(character.class)) return 'race-not-for-class';
    }

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
          race: character.race,
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
        race: true,
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
      select: { id: true, gameVersion: true, faction: true },
    });
  }
}
