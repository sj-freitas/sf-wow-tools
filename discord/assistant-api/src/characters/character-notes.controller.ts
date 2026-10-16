import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { MAX_IMAGE_BYTES } from '../officer-requests/attachments';
import { CharacterNotesService, type OfficerNoteDto } from './character-notes.service';

/**
 * Officers' private notes about the guild's characters. Every route is for the guild's Officers
 * only — players never see a note, not even about their own characters.
 */
@Controller('guilds/:guildId')
@UseGuards(AuthGuard)
export class CharacterNotesController {
  constructor(
    private readonly notes: CharacterNotesService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  /** Which characters have a note, to mark them on the roster. */
  @Get('character-notes')
  async withNotes(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<{ characterIds: string[] }> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return { characterIds: await this.notes.withNotes(guildId) };
  }

  @Get('characters/:characterId/note')
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('characterId') characterId: string,
  ): Promise<OfficerNoteDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.notes.get(guildId, characterId);
  }

  /** `markdown`: the whole note (empty clears it). */
  @Put('characters/:characterId/note')
  @HttpCode(HttpStatus.NO_CONTENT)
  async save(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('characterId') characterId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (typeof body.markdown !== 'string') throw new BadRequestException('No note was sent.');
    await this.notes.save(guildId, characterId, body.markdown, req.user.displayName);
  }

  @Post('characters/:characterId/note/images')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async addImage(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('characterId') characterId: string,
    @UploadedFile() file?: { buffer: Buffer },
  ): Promise<{ id: string; contentType: string }> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!file) throw new BadRequestException('No image was sent.');
    return this.notes.addImage(guildId, characterId, file.buffer, req.user.displayName);
  }

  @Delete('characters/:characterId/note/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeImage(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('characterId') characterId: string,
    @Param('imageId') imageId: string,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    await this.notes.removeImage(guildId, characterId, imageId);
  }

  @Get('character-notes/images/:imageId')
  async image(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    const image = await this.notes.getImage(guildId, imageId);
    if (!image) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'No image' });
      return;
    }
    res
      .set({
        'Content-Type': image.contentType,
        // Private to the Officer's browser: never a shared cache.
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(image.data);
  }
}
