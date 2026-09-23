import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { isWowClass } from '../game/wow-class';
import { parseCharacterName } from './character-name';
import { CharactersService, type CharacterUpdate } from './characters.service';

const ROLES: readonly Role[] = ['TANK', 'HEALER', 'MELEE_DPS', 'RANGED_DPS'];

/** Backoffice character management; every route requires the Guild-Assistant role. */
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
    await this.guildAccess.assertAdmin(req.user.id, guildId);

    const discordUserId = body.discordUserId;
    if (typeof discordUserId !== 'string' || !/^\d{15,25}$/.test(discordUserId)) {
      throw new BadRequestException('discordUserId must be a Discord user id (digits)');
    }
    const name = parseCharacterName(typeof body.name === 'string' ? body.name : '');
    if (!name) {
      throw new BadRequestException('name must be Name or Name-Lastname (letters, 2-12 each)');
    }
    const fields = parseFields(body, { partial: false });

    const result = await this.charactersService.addToGuild(guildId, discordUserId, {
      ...name,
      class: fields.class as string,
      roles: fields.roles as Role[],
      isMain: fields.isMain ?? false,
      level: fields.level,
    });
    if (result === 'duplicate') {
      throw new ConflictException('That player already has a character with this name');
    }
    if (result === 'no-guild') {
      throw new NotFoundException('Guild not found');
    }
  }

  @Patch('characters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.assertCanManage(req.user.id, id);
    const patch = parseFields(body, { partial: true });
    if (body.name !== undefined) {
      const name = parseCharacterName(typeof body.name === 'string' ? body.name : '');
      if (!name) {
        throw new BadRequestException('name must be Name or Name-Lastname (letters, 2-12 each)');
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
    await this.assertCanManage(req.user.id, id);
    try {
      await this.charactersService.removeById(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Character not found');
      }
      throw error;
    }
  }

  private async assertCanManage(userId: string, characterId: string): Promise<void> {
    const guildId = await this.charactersService.findGuildIdOfCharacter(characterId);
    await this.guildAccess.assertAdmin(userId, guildId);
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
