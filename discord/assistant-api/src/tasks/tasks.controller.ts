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
import type { Reactor } from './dynamic-content';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import {
  TasksService,
  type ReactionDto,
  type ServerChannelsDto,
  type TaskDto,
  type TaskPageDto,
  type TaskInput,
} from './tasks.service';

/**
 * Scheduled tasks, for Officers only. The background worker that runs them is an
 * implementation detail: nothing here mentions it.
 */
@Controller()
@UseGuards(AuthGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly guildAccess: GuildAccessService,
  ) {}

  /** `page` from 1, ten posts to a page; `query` searches every page by name and text. */
  @Get('guilds/:guildId/tasks')
  async list(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('query') query?: string,
    @Query('page') page?: string,
  ): Promise<TaskPageDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.tasks.list(guildId, { query, page });
  }

  @Get('guilds/:guildId/channels')
  async channels(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
  ): Promise<ServerChannelsDto[]> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    return this.tasks.listChannels(guildId);
  }

  @Post('guilds/:guildId/tasks')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: TaskInput,
  ): Promise<TaskDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    return this.tasks.create(guildId, req.user.id, body);
  }

  @Get('tasks/:id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<TaskDto> {
    await this.assertOfficerOfTask(req, id);
    return this.tasks.get(id);
  }

  @Patch('tasks/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: TaskInput,
  ): Promise<TaskDto> {
    await this.assertOfficerOfTask(req, id);
    return this.tasks.update(id, body);
  }

  /** Deletes the message from Discord; the task stays and can be posted again. */
  @Post('tasks/:id/delete-post')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePost(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.assertOfficerOfTask(req, id);
    await this.tasks.deletePost(id);
  }

  /** Untrack: removes the task from the backoffice and database; the Discord message stays. */
  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.assertOfficerOfTask(req, id);
    await this.tasks.remove(id);
  }

  @Post('tasks/:id/run-now')
  @HttpCode(HttpStatus.NO_CONTENT)
  async runNow(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.assertOfficerOfTask(req, id);
    await this.tasks.runNow(id);
  }

  @Get('tasks/:id/reactions')
  async reactions(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ReactionDto[]> {
    await this.assertOfficerOfTask(req, id);
    return this.tasks.reactions(id);
  }

  /** Who reacted with one emoji (`?emoji=👍`, or `name:id` for a custom one), without the bot. */
  @Get('tasks/:id/reactions/users')
  async reactionUsers(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('emoji') emoji?: string,
  ): Promise<Reactor[]> {
    await this.assertOfficerOfTask(req, id);
    return this.tasks.reactionUsers(id, emoji);
  }

  private async assertOfficerOfTask(req: AuthenticatedRequest, taskId: string): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, await this.tasks.guildIdOf(taskId));
  }
}
