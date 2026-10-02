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
  race: string;
  roles: Role[];
  isMain: boolean;
  level?: number;
}

export type CharacterUpdate = Partial<
  Pick<NewCharacter, 'class' | 'race' | 'roles' | 'isMain' | 'level' | 'firstName' | 'lastName'>
> & {
  /** A deliberate faction change; the race (new or existing) must fit it, same as on creation. */
  faction?: Faction;
};

/** The guild a character is being added to or migrated into: its server and its faction. */
interface GuildServer {
  id: string;
  gameVersion: string;
  faction: Faction;
  region: string;
  realm: string;
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

export type MigrateResult =
  | 'migrated'
  | 'already-member'
  | 'not-found'
  | 'no-guild'
  | 'wrong-server'
  | 'wrong-faction'
  | 'forbidden';

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
  id: string;
  class: string;
  race: string;
  faction: Faction;
  roles: Role[];
  isMain: boolean;
  level: number;
}

const CHARACTER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  class: true,
  race: true,
  faction: true,
  roles: true,
  isMain: true,
  level: true,
} as const;

@Injectable()
export class CharactersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly discord: DiscordOAuthService,
  ) {}

  /**
   * Adds a character for the user, registering them as a player (globally, by Discord id) on
   * first use.
   */
  async add(owner: CharacterOwner, character: NewCharacter): Promise<AddResult> {
    const guild = await this.findGuildByServer(owner.discordServerId);
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
      select: { id: true, gameVersion: true, faction: true, region: true, realm: true },
    });
    if (!guild) {
      return 'no-guild';
    }
    return this.createForPlayer(guild, discordUserId, character, names);
  }

  /**
   * The player's other characters on this guild's server (same game version, region and realm)
   * that fit its faction and are not already in it — offered as "migrate this character" instead
   * of creating a new one, since the same account's character on this server is the same
   * character, not a new one.
   */
  async migrateCandidates(guildId: string, discordUserId: string): Promise<CharacterSummary[]> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { gameVersion: true, faction: true, region: true, realm: true },
    });
    const player = await this.prisma.player.findUnique({ where: { discordUserId } });
    if (!guild || !player) return [];
    return this.prisma.character.findMany({
      where: {
        playerId: player.id,
        gameVersion: guild.gameVersion,
        region: guild.region,
        realm: guild.realm,
        faction: guild.faction,
        guilds: { none: { guildId } },
      },
      orderBy: [{ isMain: 'desc' }, { firstName: 'asc' }],
      select: CHARACTER_SELECT,
    });
  }

  /** Adds an existing character to another guild's roster, without creating a new row. */
  async migrate(
    guildId: string,
    characterId: string,
    requesterDiscordUserId: string,
    allowAnyOwner: boolean,
  ): Promise<MigrateResult> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { gameVersion: true, faction: true, region: true, realm: true },
    });
    if (!guild) return 'no-guild';
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: {
        gameVersion: true,
        region: true,
        realm: true,
        faction: true,
        player: { select: { discordUserId: true } },
      },
    });
    if (!character) return 'not-found';
    if (!allowAnyOwner && character.player.discordUserId !== requesterDiscordUserId) {
      return 'forbidden';
    }
    if (
      character.gameVersion !== guild.gameVersion ||
      character.region !== guild.region ||
      character.realm !== guild.realm
    ) {
      return 'wrong-server';
    }
    if (character.faction !== guild.faction) return 'wrong-faction';

    try {
      await this.prisma.characterGuildMembership.create({ data: { characterId, guildId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'already-member';
      }
      throw error;
    }
    this.realtime.publish(guildId, 'characters');
    return 'migrated';
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
   * Changes a character's own fields (name, class, race, roles, level, main). Guild-agnostic: the
   * same character looks the same in every guild it is in, so this does not take a guild (a guild
   * is only needed to check who may make the change, which the controller does separately). With
   * `newOwner` it moves the character to another Discord user's (global) player, created if they
   * have none; the previous player is removed when it is left with no characters anywhere.
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
      patch.roles !== undefined ||
      patch.faction !== undefined
    ) {
      const character = await this.prisma.character.findUnique({
        where: { id: characterId },
        select: { class: true, race: true, roles: true, gameVersion: true, faction: true },
      });
      if (!character) {
        throw new NotFoundException('Character not found');
      }
      const { gameVersion } = character;
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
      // Changing either the race or the faction: the race (new or existing) must fit the faction
      // (new or existing) — the same check creation does, just against the character's own faction
      // rather than one specific guild's (it may be in several, or none).
      if (patch.race !== undefined || patch.faction !== undefined) {
        const faction = patch.faction ?? character.faction;
        const race = patch.race ?? character.race;
        if (race !== '' && !raceInFaction(gameVersion, faction, race)) {
          throw new BadRequestException(`${gameVersion} has no ${race} race for that faction.`);
        }
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
      // Changing the race, the faction or the class, with a known race: the class must still fit it.
      if (patch.race !== undefined || patch.faction !== undefined || patch.class !== undefined) {
        const faction = patch.faction ?? character.faction;
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
        select: { playerId: true, player: { select: { discordUserId: true } } },
      });
      if (!current) throw new NotFoundException('Character not found');
      if (current.player.discordUserId !== newOwner.discordUserId) {
        const target = await this.prisma.player.upsert({
          where: { discordUserId: newOwner.discordUserId },
          create: {
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

    await this.prisma.character.update({
      where: { id: characterId },
      data: playerId ? { ...patch, playerId } : patch,
      select: { id: true },
    });
    if (previousPlayerId) {
      // A player with no characters left anywhere is removed.
      const left = await this.prisma.character.count({ where: { playerId: previousPlayerId } });
      if (left === 0) await this.prisma.player.deleteMany({ where: { id: previousPlayerId } });
    }
    await this.publishToItsGuilds(characterId);
  }

  /** Removes a character from one guild's roster; the character itself (and its other guilds, if
   * any) are untouched — it just stops being a pointer into this guild. */
  async removeFromGuild(guildId: string, characterId: string): Promise<'removed' | 'not-found'> {
    const { count } = await this.prisma.characterGuildMembership.deleteMany({
      where: { characterId, guildId },
    });
    if (count === 0) return 'not-found';
    this.realtime.publish(guildId, 'characters');
    return 'removed';
  }

  /** The Discord id of the character's own player, or null if the character does not exist. */
  async findOwnerDiscordId(characterId: string): Promise<string | null> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { player: { select: { discordUserId: true } } },
    });
    return character?.player.discordUserId ?? null;
  }

  private async createForPlayer(
    guild: GuildServer,
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
    // Race is required (a CHECK on the table refuses an empty one); still guarded here in case
    // it is ever blank, the same way class and roles fall back to "anything goes" for a version we
    // know nothing of.
    if (character.race !== '') {
      if (!raceInFaction(guild.gameVersion, guild.faction, character.race)) return 'unknown-race';
      const allowed = classesOfRace(guild.gameVersion, guild.faction, character.race);
      if (allowed && !allowed.includes(character.class)) return 'race-not-for-class';
    }

    const player = await this.upsertPlayer(discordUserId, names);

    try {
      const created = await this.prisma.character.create({
        data: {
          playerId: player.id,
          gameVersion: guild.gameVersion,
          region: guild.region,
          realm: guild.realm,
          faction: guild.faction,
          class: character.class,
          race: character.race,
          roles: character.roles,
          firstName: character.firstName,
          lastName: character.lastName,
          isMain: character.isMain,
          level: character.level,
        },
      });
      await this.prisma.characterGuildMembership.create({
        data: { characterId: created.id, guildId: guild.id },
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
    const guild = await this.findGuildByServer(owner.discordServerId);
    if (!guild) {
      return null;
    }
    const player = await this.prisma.player.findUnique({
      where: { discordUserId: owner.discordUserId },
    });
    if (!player) return [];
    return this.prisma.character.findMany({
      where: { playerId: player.id, guilds: { some: { guildId: guild.id } } },
      orderBy: [{ isMain: 'desc' }, { firstName: 'asc' }],
      select: CHARACTER_SELECT,
    });
  }

  async remove(
    owner: CharacterOwner,
    name: CharacterName,
  ): Promise<'removed' | 'not-found' | 'no-guild'> {
    const guild = await this.findGuildByServer(owner.discordServerId);
    if (!guild) {
      return 'no-guild';
    }
    const character = await this.prisma.character.findFirst({
      where: {
        firstName: name.firstName,
        lastName: name.lastName,
        player: { discordUserId: owner.discordUserId },
        guilds: { some: { guildId: guild.id } },
      },
      select: { id: true },
    });
    if (!character) {
      return 'not-found';
    }
    return this.removeFromGuild(guild.id, character.id);
  }

  private upsertPlayer(discordUserId: string, names?: DiscordNames) {
    return this.prisma.player.upsert({
      where: { discordUserId },
      create: {
        discordUserId,
        discordUsername: names?.username,
        discordDisplayName: names?.displayName,
      },
      update: {
        discordUsername: names?.username,
        discordDisplayName: names?.displayName,
      },
    });
  }

  /** Every guild this character is a member of gets told its roster changed. */
  private async publishToItsGuilds(characterId: string): Promise<void> {
    const memberships = await this.prisma.characterGuildMembership.findMany({
      where: { characterId },
      select: { guildId: true },
    });
    for (const { guildId } of memberships) this.realtime.publish(guildId, 'characters');
  }

  private findGuildByServer(discordServerId: string) {
    return this.prisma.guild.findFirst({
      where: { servers: { some: { discordId: discordServerId } } },
      select: { id: true, gameVersion: true, faction: true, region: true, realm: true },
    });
  }
}
