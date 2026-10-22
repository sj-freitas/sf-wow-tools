import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  ProfessionsService,
  type GuildProfessionsDto,
  type ImportResultDto,
  type ProfessionDto,
} from './professions.service';

/** Professions from the GuildAssistant Professions addon (see ProfessionsService). */
@Controller('guilds/:guildId')
@UseGuards(AuthGuard)
export class ProfessionsController {
  constructor(private readonly professions: ProfessionsService) {}

  /** `{ data }`: the addon's export, as pasted: the user's characters and the guildmates' it carries. */
  @Post('professions/import')
  @HttpCode(HttpStatus.OK)
  import(
    @Req() req: AuthenticatedRequest,
    @Param('guildId', ParseUUIDPipe) guildId: string,
    @Body() body: { data?: unknown },
  ): Promise<ImportResultDto> {
    return this.professions.import(req.user, guildId, body.data);
  }

  /** Everyone's professions in the guild, by recipe (the guild's Professions page). */
  @Get('professions')
  guild(
    @Req() req: AuthenticatedRequest,
    @Param('guildId', ParseUUIDPipe) guildId: string,
  ): Promise<GuildProfessionsDto> {
    return this.professions.guild(req.user.id, guildId);
  }

  @Get('characters/:characterId/professions')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('guildId', ParseUUIDPipe) guildId: string,
    @Param('characterId', ParseUUIDPipe) characterId: string,
  ): Promise<ProfessionDto[]> {
    return this.professions.list(req.user.id, guildId, characterId);
  }
}

/** A character's professions on its own page, which belongs to no guild. */
@Controller('characters')
@UseGuards(AuthGuard)
export class CharacterProfessionsController {
  constructor(private readonly professions: ProfessionsService) {}

  /** Any logged-in user, like the character's page. */
  @Get(':characterId/professions')
  list(@Param('characterId', ParseUUIDPipe) characterId: string): Promise<ProfessionDto[]> {
    return this.professions.forCharacter(characterId);
  }

  /** "Drop this profession": its player, or an Officer of a guild it is in. Main ones only. */
  @Delete(':characterId/professions/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  drop(
    @Req() req: AuthenticatedRequest,
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Param('name') name: string,
  ): Promise<void> {
    return this.professions.drop(req.user, characterId, name);
  }
}
