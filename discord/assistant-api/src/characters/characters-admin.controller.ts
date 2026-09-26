import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest, SessionUser } from '../auth/auth.types';
import { canEditCharacter, canManageAllCharacters } from '../auth/access-rules';
import { GuildAccessService } from '../auth/guild-access.service';
import { isWowClass } from '../game/games';
import { parseCharacterName } from './character-name';
import { CharactersService, type CharacterUpdate } from './characters.service';

const ROLES: readonly Role[] = ['TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS'];

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

    let discordUserId = req.user.discordId;
    let names: { username: string; displayName: string | null } | null = {
      username: req.user.username,
      displayName: req.user.displayName === req.user.username ? null : req.user.displayName,
    };
    if (canManageAllCharacters(access)) {
      // Officers may add characters for any member of the guild's servers (default: themselves).
      if (body.discordUserId !== undefined && body.discordUserId !== req.user.discordId) {
        if (typeof body.discordUserId !== 'string' || !/^\d{15,25}$/.test(body.discordUserId)) {
          throw new BadRequestException('discordUserId must be a Discord user id (digits)');
        }
        discordUserId = body.discordUserId;
        names = await this.charactersService.findGuildMemberNames(guildId, discordUserId);
        if (!names) {
          throw new BadRequestException(
            "That user is not a member of any of this guild's Discord servers",
          );
        }
      }
    } else if (body.discordUserId !== undefined && body.discordUserId !== req.user.discordId) {
      throw new ForbiddenException('You can only add your own characters');
    }

    const result = await this.charactersService.addToGuild(
      guildId,
      discordUserId,
      {
        ...name,
        class: fields.class as string,
        roles: fields.roles as Role[],
        isMain: fields.isMain ?? false,
        level: fields.level,
      },
      names,
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
    if (result === 'last-name-required') {
      throw new BadRequestException(
        "This guild's game version needs a last name: use Name-Lastname",
      );
    }
  }

  @Patch('characters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.assertCanEdit(req.user, id);
    const patch = parseFields(body, { partial: true });
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
      await this.charactersService.update(id, patch);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That player already has a character with this name');
      }
      throw error;
    }
  }

  @Delete('characters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.assertCanEdit(req.user, id);
    try {
      await this.charactersService.removeById(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Character not found');
      }
      throw error;
    }
  }

  /** Officers can edit any character of their guild; members only their own. */
  private async assertCanEdit(user: SessionUser, characterId: string): Promise<void> {
    const { guildId, discordUserId } = await this.charactersService.findOwnership(characterId);
    const access = await this.guildAccess.find(user.id, guildId);
    if (!canEditCharacter(access, discordUserId, user.discordId)) {
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
