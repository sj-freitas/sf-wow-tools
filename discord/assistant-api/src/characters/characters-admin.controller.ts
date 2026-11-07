import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CharacterActionsService } from './character-actions.service';
import type { CharacterSummary } from './characters.service';

/**
 * Backoffice character management. Officers manage every player's characters;
 * any other member of the guild (one of its Discord servers) manages only their own. The rules
 * are in `CharacterActionsService`, shared with the MCP server.
 */
@Controller()
@UseGuards(AuthGuard)
export class CharactersAdminController {
  constructor(private readonly actions: CharacterActionsService) {}

  @Post('guilds/:guildId/characters')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    return this.actions.create(req.user, guildId, body);
  }

  /**
   * The requester's (or, for an Officer, another member's) characters already on this guild's
   * server and faction that are not in it yet — offered as "migrate" in the add-character form.
   */
  @Get('guilds/:guildId/characters/migratable')
  migratable(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('discordUserId') queriedUserId: string | undefined,
  ): Promise<CharacterSummary[]> {
    return this.actions.migratable(req.user, guildId, queriedUserId);
  }

  /** Adds an existing character (the requester's, or anyone's for an Officer) to this guild. */
  @Post('guilds/:guildId/characters/:id/migrate')
  @HttpCode(HttpStatus.NO_CONTENT)
  migrate(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.actions.migrate(req.user, guildId, id);
  }

  /** "This is mine": an unclaimed character on the guild's roster becomes the requester's. */
  @Post('guilds/:guildId/characters/:id/claim')
  @HttpCode(HttpStatus.NO_CONTENT)
  claim(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.actions.claim(req.user, guildId, id);
  }

  @Patch('guilds/:guildId/characters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    return this.actions.update(req.user, guildId, id, body);
  }

  /** Removes the character from this guild's roster only; it (and its other guilds) are kept. */
  @Delete('guilds/:guildId/characters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.actions.remove(req.user, guildId, id);
  }
}
