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
  PluginsService,
  type PluginDto,
  type PluginInput,
  type PluginKindDto,
} from './plugins.service';

/** Plugins, for Officers only. */
@Controller()
@UseGuards(AuthGuard)
export class PluginsController {
  constructor(
    private readonly plugins: PluginsService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  /** The kinds of plugin there are to add. */
  @Get('guilds/:guildId/plugin-kinds')
  async kinds(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<PluginKindDto[]> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.plugins.kinds();
  }

  @Get('guilds/:guildId/plugins')
  async list(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<PluginDto[]> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.plugins.list(guildId);
  }

  @Post('guilds/:guildId/plugins')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: PluginInput,
  ): Promise<PluginDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.plugins.create(guildId, req.user.id, body);
  }

  @Patch('plugins/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: PluginInput,
  ): Promise<PluginDto> {
    await this.assertOfficerOf(req, id);
    return this.plugins.update(id, body);
  }

  @Post('plugins/:id/run-now')
  @HttpCode(HttpStatus.NO_CONTENT)
  async runNow(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.assertOfficerOf(req, id);
    await this.plugins.runNow(id);
  }

  @Delete('plugins/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.assertOfficerOf(req, id);
    await this.plugins.remove(id);
  }

  private async assertOfficerOf(req: AuthenticatedRequest, pluginId: string): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, await this.plugins.guildIdOf(pluginId));
  }
}
