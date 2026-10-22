import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import {
  channelPermissions,
  missingFor,
  PERMISSION_LABELS,
  REQUIRED,
  type ChannelUse,
} from './channel-permissions';
import { ProblemsService, type ProblemDto } from './problems.service';

@Controller('guilds/:guildId')
@UseGuards(AuthGuard)
export class ProblemsController {
  constructor(
    private readonly problems: ProblemsService,
    private readonly guildAccess: GuildAccessService,
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  /** What the bot can't do for the guild right now (Officers: shown in Officer requests). */
  @Get('problems')
  async list(
    @Req() req: AuthenticatedRequest,
    @Param('guildId', ParseUUIDPipe) guildId: string,
  ): Promise<ProblemDto[]> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.problems.list(guildId);
  }

  /** An Officer marks a problem solved (it comes back if the task fails again). */
  @Post('problems/:problemId/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resolve(
    @Req() req: AuthenticatedRequest,
    @Param('guildId', ParseUUIDPipe) guildId: string,
    @Param('problemId', ParseUUIDPipe) problemId: string,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!(await this.problems.resolve(guildId, problemId))) {
      throw new NotFoundException('That problem is already gone.');
    }
  }

  /**
   * Before saving a task: what the bot lacks in the chosen channel for `use` (post, cleanup,
   * honeypot), by name. `missing: null` when it can't be told (then nothing is shown). Only for the
   * guild's own servers' channels, and anyone in the guild (event creators pick channels too).
   */
  @Get('channel-check')
  async check(
    @Req() req: AuthenticatedRequest,
    @Param('guildId', ParseUUIDPipe) guildId: string,
    @Query('channelId') channelId?: string,
    @Query('use') use?: string,
  ): Promise<{ missing: string[] | null }> {
    if (!(await this.guildAccess.find(req.user.id, guildId))) {
      throw new ForbiddenException('You are not a member of this guild');
    }
    if (!channelId || !/^\d{5,25}$/.test(channelId) || !use || !(use in REQUIRED)) {
      throw new BadRequestException(
        'channelId and use (post, cleanup, recurring or honeypot) are needed',
      );
    }
    try {
      const inputs = await this.bot.channelPermissionInputs(channelId);
      const server = await this.prisma.discordServer.findFirst({
        where: { guildId, discordId: inputs.serverId },
        select: { id: true },
      });
      if (!server) return { missing: null };
      const missing = missingFor(use as ChannelUse, channelPermissions(inputs));
      return { missing: missing.map((name) => PERMISSION_LABELS[name]) };
    } catch {
      return { missing: null };
    }
  }
}
