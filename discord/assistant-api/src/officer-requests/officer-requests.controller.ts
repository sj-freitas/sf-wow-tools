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
  Query,
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
import { parseSnowflake } from '../tasks/post-task';
import {
  ConversationsService,
  type ConversationDto,
  type ConversationPageDto,
} from './conversations.service';
import { MAX_IMAGE_BYTES, toMessageImage } from './attachments';
import { MAX_MESSAGE_LENGTH, OfficerRequestsService } from './officer-requests.service';

/** Officer requests in the backoffice: Officers read and reply; the channel is guild configuration. */
@Controller('guilds/:guildId')
@UseGuards(AuthGuard)
export class OfficerRequestsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly officerRequests: OfficerRequestsService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  @Get('officer-requests')
  async list(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('query') query?: string,
    @Query('page') page?: string,
  ): Promise<ConversationPageDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.conversations.list(guildId, { query, page });
  }

  @Get('officer-requests/:publicId')
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('publicId') publicId: string,
  ): Promise<ConversationDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!/^\d{8}$/.test(publicId)) throw new BadRequestException('Not a conversation id');
    return this.conversations.get(guildId, Number(publicId));
  }

  /** Officers only. Sends the same reply as /contact-officer-reply, in the officer's display name. */
  @Post('officer-requests/:publicId/replies')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async reply(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('publicId') publicId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: { buffer: Buffer },
  ): Promise<{ dmDelivered: boolean }> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!/^\d{8}$/.test(publicId)) throw new BadRequestException('Not a conversation id');
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw new BadRequestException('Write a message first.');
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`);
    }
    const image = file ? toMessageImage(file.buffer) : undefined;
    if (typeof image === 'string') throw new BadRequestException(image);
    return this.officerRequests.replyAsOfficer(
      guildId,
      Number(publicId),
      { id: req.user.discordId, name: req.user.displayName },
      message,
      image,
    );
  }

  /** Officers only: the picture of one message. */
  @Get('officer-requests/:publicId/messages/:messageId/image')
  async image(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('publicId') publicId: string,
    @Param('messageId') messageId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!/^\d{8}$/.test(publicId)) throw new BadRequestException('Not a conversation id');
    const image = await this.conversations.getImage(guildId, Number(publicId), messageId);
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

  /** Officers only. `{ locked: true }` locks the conversation, `{ locked: false }` unlocks it. */
  @Put('officer-requests/:publicId/lock')
  @HttpCode(HttpStatus.NO_CONTENT)
  async lock(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('publicId') publicId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!/^\d{8}$/.test(publicId)) throw new BadRequestException('Not a conversation id');
    if (typeof body.locked !== 'boolean') throw new BadRequestException('Say whether to lock it.');
    await this.officerRequests.setLocked(guildId, Number(publicId), body.locked);
  }

  /** Officers only. Removes the conversation and its messages in the request channel. */
  @Delete('officer-requests/:publicId')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('publicId') publicId: string,
  ): Promise<{ notDeleted: number }> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!/^\d{8}$/.test(publicId)) throw new BadRequestException('Not a conversation id');
    return this.officerRequests.deleteConversation(guildId, Number(publicId));
  }

  /** Guild-Assistants and Officers. `channelId: null` clears the channel. */
  @Put('officer-request-channel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setChannel(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    if (body.channelId === null) {
      await this.officerRequests.setChannel(guildId, null);
      return;
    }
    await this.officerRequests.setChannel(guildId, {
      serverId: parseSnowflake(body.serverId, 'The server'),
      channelId: parseSnowflake(body.channelId, 'The channel'),
    });
  }
}
