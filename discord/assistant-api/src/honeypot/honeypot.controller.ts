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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import {
  HoneypotService,
  type HoneypotDto,
  type HoneypotEventDto,
  type HoneypotInput,
} from './honeypot.service';

/** Honeypot channels, for Officers only. */
@Controller()
@UseGuards(AuthGuard)
export class HoneypotController {
  constructor(
    private readonly honeypots: HoneypotService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  @Get('guilds/:guildId/honeypots')
  async list(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<HoneypotDto[]> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.honeypots.list(guildId);
  }

  @Post('guilds/:guildId/honeypots')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: HoneypotInput,
  ): Promise<HoneypotDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.honeypots.create(guildId, req.user.id, body);
  }

  @Patch('honeypots/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: HoneypotInput,
  ): Promise<HoneypotDto> {
    await this.assertOfficerOf(req, id);
    return this.honeypots.update(id, body);
  }

  @Delete('honeypots/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.assertOfficerOf(req, id);
    await this.honeypots.remove(id);
  }

  @Get('honeypots/:id/events')
  async events(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<HoneypotEventDto[]> {
    await this.assertOfficerOf(req, id);
    return this.honeypots.events(id);
  }

  private async assertOfficerOf(req: AuthenticatedRequest, honeypotId: string): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, await this.honeypots.guildIdOf(honeypotId));
  }
}
