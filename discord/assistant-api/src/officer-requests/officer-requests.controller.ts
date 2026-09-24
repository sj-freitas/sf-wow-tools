import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { parseSnowflake } from '../tasks/post-task';
import {
  ConversationsService,
  type ConversationDto,
  type ConversationPageDto,
} from './conversations.service';
import { OfficerRequestsService } from './officer-requests.service';

/** Officer requests in the backoffice: read-only for Officers; the channel is guild configuration. */
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
