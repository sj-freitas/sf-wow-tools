import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import type { SessionUser } from '../auth/auth.types';
import {
  canEditCharacter,
  canManageAllCharacters,
  type GuildAccessFlags,
} from '../auth/access-rules';
import { GuildAccessService } from '../auth/guild-access.service';
import { isWowClass } from '../game/games';
import { formatCharacterName, parseCharacterName } from './character-name';
import {
  CharactersService,
  type CharacterSummary,
  type CharacterUpdate,
} from './characters.service';

const ROLES: readonly Role[] = ['TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS'];
const DISCORD_ID = /^\d{15,25}$/;

/**
 * Managing a guild's characters as a user: who may do what (Officers every player's characters,
 * any other member of the guild only their own), the checks on the fields, and the API's errors.
 * The backoffice (`CharactersAdminController`) and the MCP server (`CharactersMcpTools`) both go
 * through here, so the rules are the same whichever way a change comes in.
 */
@Injectable()
export class CharacterActionsService {
  constructor(
    private readonly charactersService: CharactersService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  /**
   * Adds a new character: the user's, (for an Officer) another member's by `discordUserId`, or (for
   * an Officer, `unclaimed: true`) no one's yet. A name an unclaimed character has on the server
   * claims that one instead, for whoever it is being added for.
   */
  async create(user: SessionUser, guildId: string, body: Record<string, unknown>): Promise<void> {
    const access = await this.guildAccess.find(user.id, guildId);
    if (!access) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    const unclaimed = body.unclaimed === true;
    if (unclaimed && !canManageAllCharacters(access)) {
      throw new ForbiddenException('Only Officers can add a character no one has claimed');
    }
    if (unclaimed && body.discordUserId !== undefined) {
      throw new BadRequestException('An unclaimed character has no discordUserId');
    }

    const name = parseCharacterName(typeof body.name === 'string' ? body.name : '');
    if (!name) {
      throw new BadRequestException(
        'name must be Name or Name-Lastname (letters, at least 2 each)',
      );
    }
    const fields = parseFields(body, { partial: false });
    const target = unclaimed ? null : await this.resolveTargetUser(user, guildId, access, body);

    const result = await this.charactersService.addToGuild(
      guildId,
      target?.id ?? null,
      {
        ...name,
        class: fields.class as string,
        race: fields.race as string,
        roles: fields.roles as Role[],
        level: fields.level,
      },
      target?.names,
    );
    if (result === 'duplicate') {
      throw new ConflictException(
        `There is already a character called ${formatCharacterName(name)} on this server`,
      );
    }
    if (result === 'no-guild') {
      throw new NotFoundException('Guild not found');
    }
    if (result === 'role-not-for-class') {
      throw new BadRequestException(
        "That class cannot play those roles in this guild's game version",
      );
    }
    if (result === 'unknown-class') {
      throw new BadRequestException("This guild's game version has no such class");
    }
    if (result === 'unknown-race') {
      throw new BadRequestException("That race is not in this guild's faction");
    }
    if (result === 'race-not-for-class') {
      throw new BadRequestException("That race cannot be that class in this guild's game version");
    }
    if (result === 'last-name-required') {
      throw new BadRequestException(
        "This guild's game version needs a last name: use Name-Lastname",
      );
    }
  }

  /**
   * The user's (or, for an Officer, another member's) characters already on this guild's server
   * and faction that are not in it yet — offered as "migrate" instead of adding a duplicate.
   */
  async migratable(
    user: SessionUser,
    guildId: string,
    discordUserId: string | undefined,
  ): Promise<CharacterSummary[]> {
    const access = await this.guildAccess.find(user.id, guildId);
    if (!access) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    const target = await this.resolveTargetUser(user, guildId, access, { discordUserId });
    return this.charactersService.migrateCandidates(guildId, target.id);
  }

  /** Adds an existing character (the user's, or anyone's for an Officer) to this guild. */
  async migrate(user: SessionUser, guildId: string, id: string): Promise<void> {
    const access = await this.guildAccess.find(user.id, guildId);
    if (!access) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    const result = await this.charactersService.migrate(
      guildId,
      id,
      user.discordId,
      canManageAllCharacters(access),
    );
    if (result === 'not-found' || result === 'no-guild') {
      throw new NotFoundException('Character not found');
    }
    if (result === 'forbidden') {
      throw new ForbiddenException('You can only migrate your own characters');
    }
    if (result === 'wrong-server') {
      throw new BadRequestException("That character is not on this guild's server");
    }
    if (result === 'wrong-faction') {
      throw new BadRequestException("That character's faction does not match this guild's");
    }
    if (result === 'already-member') {
      throw new ConflictException('That character is already in this guild');
    }
  }

  /** Changes a character's fields; `discordUserId` moves it to another player (Officers). */
  async update(
    user: SessionUser,
    guildId: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.assertCanEdit(user, guildId, id);
    const patch = parseFields(body, { partial: true });
    const newOwner = await this.parseNewOwner(user, guildId, body);
    if (body.name !== undefined) {
      const name = parseCharacterName(typeof body.name === 'string' ? body.name : '');
      if (!name) {
        throw new BadRequestException(
          'name must be Name or Name-Lastname (letters, at least 2 each)',
        );
      }
      Object.assign(patch, name);
    }
    try {
      await this.charactersService.update(id, patch, newOwner);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('There is already a character with this name on this server');
      }
      throw error;
    }
  }

  /**
   * The user says an unclaimed character on the guild's roster is theirs (any member of the guild):
   * it becomes theirs. Officers can still move it to someone else if that was wrong.
   */
  async claim(user: SessionUser, guildId: string, id: string): Promise<void> {
    if (!(await this.guildAccess.find(user.id, guildId))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    const result = await this.charactersService.claim(guildId, id, user.discordId, {
      username: user.username,
      displayName: user.displayName === user.username ? null : user.displayName,
    });
    if (result === 'not-found') throw new NotFoundException('Character not found');
    if (result === 'already-claimed') {
      throw new ConflictException('Someone already plays this character');
    }
  }

  /** Removes the character from this guild's roster only; it (and its other guilds) are kept. */
  async remove(user: SessionUser, guildId: string, id: string): Promise<void> {
    // Taking it off the roster is the guild's business: Officers can, even for a verified one.
    await this.assertCanEdit(user, guildId, id, { evenIfVerified: true });
    const result = await this.charactersService.removeFromGuild(guildId, id);
    if (result === 'not-found') throw new NotFoundException('Character not found');
  }

  /**
   * Who the request is for: the user, unless they are an Officer asking for someone else (a
   * member of the guild's servers) by `discordUserId`.
   */
  private async resolveTargetUser(
    user: SessionUser,
    guildId: string,
    access: GuildAccessFlags,
    body: { discordUserId?: unknown },
  ): Promise<{ id: string; names: { username: string; displayName: string | null } }> {
    const self = {
      id: user.discordId,
      names: {
        username: user.username,
        displayName: user.displayName === user.username ? null : user.displayName,
      },
    };
    if (body.discordUserId === undefined || body.discordUserId === user.discordId) return self;
    if (!canManageAllCharacters(access)) {
      throw new ForbiddenException('You can only act for yourself');
    }
    if (typeof body.discordUserId !== 'string' || !DISCORD_ID.test(body.discordUserId)) {
      throw new BadRequestException('discordUserId must be a Discord user id (digits)');
    }
    const names = await this.charactersService.findGuildMemberNames(guildId, body.discordUserId);
    if (!names) {
      throw new BadRequestException(
        "That user is not a member of any of this guild's Discord servers",
      );
    }
    return { id: body.discordUserId, names };
  }

  /**
   * Moving a character to another Discord user is for Officers, and only to a member of the guild's
   * servers; `discordUserId: null` makes it unclaimed (Officers too). Returns nothing when the body
   * does not ask for it.
   */
  private async parseNewOwner(
    user: SessionUser,
    guildId: string,
    body: Record<string, unknown>,
  ): Promise<
    | { discordUserId: string | null; names?: { username?: string; displayName?: string | null } }
    | undefined
  > {
    if (body.discordUserId === undefined) return undefined;
    if (body.discordUserId === null) {
      const access = await this.guildAccess.find(user.id, guildId);
      if (!access || !canManageAllCharacters(access)) {
        throw new ForbiddenException('Only Officers can make a character unclaimed');
      }
      return { discordUserId: null };
    }
    if (typeof body.discordUserId !== 'string' || !DISCORD_ID.test(body.discordUserId)) {
      throw new BadRequestException('discordUserId must be a Discord user id (digits)');
    }
    if (body.discordUserId === user.discordId) return undefined;
    const access = await this.guildAccess.find(user.id, guildId);
    if (!access || !canManageAllCharacters(access)) {
      throw new ForbiddenException('Only Officers can move a character to another player');
    }
    const names = await this.charactersService.findGuildMemberNames(guildId, body.discordUserId);
    if (!names) {
      throw new BadRequestException(
        "That user is not a member of any of this guild's Discord servers",
      );
    }
    return { discordUserId: body.discordUserId, names };
  }

  /**
   * Officers can edit any character of their guild; members only their own. A character verified
   * on Battle.net only its player (unless `evenIfVerified`: taking it off the guild's roster).
   */
  private async assertCanEdit(
    user: SessionUser,
    guildId: string,
    characterId: string,
    { evenIfVerified = false }: { evenIfVerified?: boolean } = {},
  ): Promise<void> {
    const access = await this.guildAccess.find(user.id, guildId);
    const ownership = await this.charactersService.findOwnership(characterId);
    if (!ownership) {
      throw new NotFoundException('Character not found');
    }
    const verified = ownership.verified && !evenIfVerified;
    if (!canEditCharacter(access, ownership.discordUserId, user.discordId, verified)) {
      throw new ForbiddenException(
        verified && access?.isOfficer
          ? 'Its player verified this character on Battle.net: only they can change it.'
          : ownership.discordUserId === null
            ? 'No one has claimed this character yet: claim it first if it is yours'
            : 'You can only change your own characters',
      );
    }
  }
}

function parseFields(
  body: Record<string, unknown>,
  options: { partial: boolean },
): CharacterUpdate {
  const fields: CharacterUpdate = {};
  const missing = (key: string): void => {
    if (!options.partial) throw new BadRequestException(`${key} is required`);
  };

  if (body.class !== undefined) {
    if (typeof body.class !== 'string' || !isWowClass(body.class)) {
      throw new BadRequestException('Unknown class');
    }
    fields.class = body.class;
  } else missing('class');

  // Checked against the character's faction (the guild's, for a new one) in the service.
  if (body.race !== undefined) {
    if (typeof body.race !== 'string' || body.race === '') {
      throw new BadRequestException('race is required');
    }
    fields.race = body.race;
  } else missing('race');

  // A new character's faction always comes from the guild it is created in; only an edit (a
  // deliberate faction change) may set it.
  if (options.partial && body.faction !== undefined) {
    if (body.faction !== 'ALLIANCE' && body.faction !== 'HORDE') {
      throw new BadRequestException('faction must be ALLIANCE or HORDE');
    }
    fields.faction = body.faction;
  }

  if (body.roles !== undefined) {
    const roles = body.roles;
    if (
      !Array.isArray(roles) ||
      roles.length === 0 ||
      !roles.every((role): role is Role => ROLES.includes(role as Role))
    ) {
      throw new BadRequestException('roles must be a non-empty list of valid roles');
    }
    fields.roles = [...new Set(roles)];
  } else missing('roles');

  if (body.level !== undefined) {
    if (
      !Number.isInteger(body.level) ||
      (body.level as number) < 1 ||
      (body.level as number) > 100
    ) {
      throw new BadRequestException('level must be an integer between 1 and 100');
    }
    fields.level = body.level as number;
  }
  return fields;
}
