import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { GuildAttributesService, type AttributeDto } from './guild-attributes.service';

/**
 * A guild's attributes (labels Officers give characters). Everyone in the guild reads them;
 * only Officers create, change, delete and assign them.
 */
@Controller('guilds/:guildId')
@UseGuards(AuthGuard)
export class GuildAttributesController {
  constructor(
    private readonly attributes: GuildAttributesService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  @Get('attributes')
  async list(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<AttributeDto[]> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) {
      throw new ForbiddenException('You are not in this guild');
    }
    return this.attributes.list(guildId);
  }

  /** `name`, `color` (one of ATTRIBUTE_COLORS). */
  @Post('attributes')
  @HttpCode(HttpStatus.NO_CONTENT)
  async create(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    await this.attributes.create(guildId, body);
  }

  @Patch('attributes/:attributeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('attributeId') attributeId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    await this.attributes.update(guildId, attributeId, body);
  }

  @Delete('attributes/:attributeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('attributeId') attributeId: string,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    await this.attributes.delete(guildId, attributeId);
  }

  /** `attributeIds`: exactly the attributes the character has from now on. */
  @Put('characters/:characterId/attributes')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setForCharacter(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('characterId') characterId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!Array.isArray(body.attributeIds)) {
      throw new BadRequestException('No attributes were sent.');
    }
    const ids = (body.attributeIds as unknown[]).filter(
      (id): id is string => typeof id === 'string',
    );
    await this.attributes.setForCharacter(guildId, characterId, ids);
  }
}
