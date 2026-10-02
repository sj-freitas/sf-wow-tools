import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest, SessionUser } from '../auth/auth.types';
import {
  canEditCharacter,
  canManageAllCharacters,
  type GuildAccessFlags,
} from '../auth/access-rules';
import { GuildAccessService } from '../auth/guild-access.service';
import { isWowClass } from '../game/games';
import { parseCharacterName } from './character-name';
import {
  CharactersService,
  type CharacterSummary,
  type CharacterUpdate,
} from './characters.service';

const ROLES: readonly Role[] = ['TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS'];
const DISCORD_ID = /^\d{15,25}$/;

/**
 * Backoffice character management. Officers manage every player's characters;
 * any other member of the guild (one of its Discord servers) manages only their own.
 */
@Controller()
@UseGuards(AuthGuard)
export class CharactersAdminController {
  constructor(
    private readonly charactersService: CharactersService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  @Post('guilds/:guildId/characters')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const access = await this.guildAccess.find(req.user.id, guildId);
    if (!access) {
      throw new ForbiddenException('You are not a member of this guild');
    }

    const name = parseCharacterName(typeof body.name === 'string' ? body.name : '');
    if (!name) {
      throw new BadRequestException(
        'name must be Name or Name-Lastname (letters, at least 2 each)',
      );
    }
    const fields = parseFields(body, { partial: false });
    const discordUserId = await this.resolveTargetUser(req, guildId, access, body);

    const result = await this.charactersService.addToGuild(
      guildId,
      discordUserId.id,
      {
        ...name,
        class: fields.class as string,
        race: fields.race as string,
        roles: fields.roles as Role[],
        isMain: fields.isMain ?? false,
        level: fields.level,
      },
      discordUserId.names,
    );
    if (result === 'duplicate') {
      throw new ConflictException('That player already has a character with this name');
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
   * The requester's (or, for an Officer, another member's) characters already on this guild's
   * server and faction that are not in it yet — offered as "migrate" in the add-character form.
   */
  @Get('guilds/:guildId/characters/migratable')
  async migratable(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('discordUserId') queriedUserId: string | undefined,
  ): Promise<CharacterSummary[]> {
    const access = await this.guildAccess.find(req.user.id, guildId);
    if (!access) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    const discordUserId = await this.resolveTargetUser(req, guildId, access, {
      discordUserId: queriedUserId,
    });
    return this.charactersService.migrateCandidates(guildId, discordUserId.id);
  }

  /** Adds an existing character (the requester's, or anyone's for an Officer) to this guild. */
  @Post('guilds/:guildId/characters/:id/migrate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async migrate(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('id') id: string,
  ): Promise<void> {
    const access = await this.guildAccess.find(req.user.id, guildId);
    if (!access) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    const result = await this.charactersService.migrate(
      guildId,
      id,
      req.user.discordId,
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

  @Patch('guilds/:guildId/characters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.assertCanEdit(req.user, guildId, id);
    const patch = parseFields(body, { partial: true });
    const newOwner = await this.parseNewOwner(req.user, guildId, body);
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
        throw new ConflictException('That player already has a character with this name');
      }
      throw error;
    }
  }

  /** Removes the character from this guild's roster only; it (and its other guilds) are kept. */
  @Delete('guilds/:guildId/characters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.assertCanEdit(req.user, guildId, id);
    const result = await this.charactersService.removeFromGuild(guildId, id);
    if (result === 'not-found') throw new NotFoundException('Character not found');
  }

  /**
   * Who the request is for: the requester, unless they are an Officer asking for someone else (a
   * member of the guild's servers) by `discordUserId`.
   */
  private async resolveTargetUser(
    req: AuthenticatedRequest,
    guildId: string,
    access: GuildAccessFlags,
    body: { discordUserId?: unknown },
  ): Promise<{ id: string; names: { username: string; displayName: string | null } }> {
    const self = {
      id: req.user.discordId,
      names: {
        username: req.user.username,
        displayName: req.user.displayName === req.user.username ? null : req.user.displayName,
      },
    };
    if (body.discordUserId === undefined || body.discordUserId === req.user.discordId) return self;
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
   * servers. Returns nothing when the body does not ask for it.
   */
  private async parseNewOwner(
    user: SessionUser,
    guildId: string,
    body: Record<string, unknown>,
  ): Promise<
    | { discordUserId: string; names?: { username?: string; displayName?: string | null } }
    | undefined
  > {
    if (body.discordUserId === undefined) return undefined;
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

  /** Officers can edit any character of their guild; members only their own. */
  private async assertCanEdit(
    user: SessionUser,
    guildId: string,
    characterId: string,
  ): Promise<void> {
    const access = await this.guildAccess.find(user.id, guildId);
    const ownerDiscordId = await this.charactersService.findOwnerDiscordId(characterId);
    if (ownerDiscordId === null) {
      throw new NotFoundException('Character not found');
    }
    if (!canEditCharacter(access, ownerDiscordId, user.discordId)) {
      throw new ForbiddenException('You can only change your own characters');
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

  if (body.isMain !== undefined) {
    if (typeof body.isMain !== 'boolean') throw new BadRequestException('isMain must be boolean');
    fields.isMain = body.isMain;
  }
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
