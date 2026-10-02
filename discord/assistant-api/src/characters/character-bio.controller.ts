import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
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
import {
  CharacterBioService,
  MAX_BIO_IMAGES,
  type BioImage,
  type BioView,
} from './character-bio.service';

/**
 * A character's bio: free text, personal to its own player, shown to others only when they choose
 * (and only at all on a guild whose server has the 'RP' rule set). See `CharacterBioService`.
 */
@Controller()
@UseGuards(AuthGuard)
export class CharacterBioController {
  constructor(
    private readonly bioService: CharacterBioService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  /** Any member of the guild; the bio text itself only if the viewer may see it. */
  @Get('guilds/:guildId/characters/bio/:namePath')
  async find(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('namePath') namePath: string,
  ): Promise<BioView> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    const result = await this.bioService.findBio(guildId, namePath, req.user.discordId);
    if (result === 'no-guild' || result === 'not-supported' || result === 'not-found') {
      throw new NotFoundException(
        result === 'not-supported'
          ? 'Bios are only for guilds on an RP server'
          : 'Character not found',
      );
    }
    return result;
  }

  /** Only the character's own player: not even an Officer may write someone else's bio. */
  @Patch('characters/:id/bio')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const patch: { bio?: string; bioVisible?: boolean } = {};
    if (body.bio !== undefined) {
      if (typeof body.bio !== 'string') throw new BadRequestException('bio must be a string');
      patch.bio = body.bio;
    }
    if (body.bioVisible !== undefined) {
      if (typeof body.bioVisible !== 'boolean') {
        throw new BadRequestException('bioVisible must be a boolean');
      }
      patch.bioVisible = body.bioVisible;
    }

    const result = await this.bioService.updateBio(id, req.user.discordId, patch);
    if (result === 'not-found') throw new NotFoundException('Character not found');
    if (result === 'forbidden') {
      throw new ForbiddenException('Only the character’s own player can write its bio');
    }
    if (result === 'not-supported') {
      throw new BadRequestException('Bios are only for guilds on an RP server');
    }
  }

  /** Only the character's own player; up to `MAX_BIO_IMAGES`. */
  @Post('characters/:id/bio/images')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async addImage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @UploadedFile() file?: { buffer: Buffer },
  ): Promise<BioImage> {
    if (!file) throw new BadRequestException('No image was sent.');
    const result = await this.bioService.addImage(id, req.user.discordId, file.buffer);
    if (result === 'not-found') throw new NotFoundException('Character not found');
    if (result === 'forbidden') {
      throw new ForbiddenException('Only the character’s own player can write its bio');
    }
    if (result === 'not-supported') {
      throw new BadRequestException('Bios are only for guilds on an RP server');
    }
    if (result === 'too-many') {
      throw new BadRequestException(`A bio can have at most ${MAX_BIO_IMAGES} images.`);
    }
    return result;
  }

  /** Only the character's own player. */
  @Delete('characters/:id/bio/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeImage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ): Promise<void> {
    const result = await this.bioService.removeImage(id, imageId, req.user.discordId);
    if (result === 'not-found') throw new NotFoundException('Image not found');
    if (result === 'forbidden') {
      throw new ForbiddenException('Only the character’s own player can write its bio');
    }
  }

  /** A bio image's bytes, for display. Any logged-in user: the id is only ever handed out
   * through `find`, which already applies the bio's visibility rule. */
  @Get('characters/bio/images/:imageId')
  async image(@Param('imageId') imageId: string, @Res() res: Response): Promise<void> {
    const image = await this.bioService.getImage(imageId);
    if (!image) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'No image' });
      return;
    }
    res
      .set({
        'Content-Type': image.contentType,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(image.data);
  }
}
