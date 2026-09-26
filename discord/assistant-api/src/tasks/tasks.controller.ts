import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { Reactor } from './dynamic-content';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { MAX_IMAGE_BYTES } from '../officer-requests/attachments';
import { PostImagesService, type PostImageDto } from './post-images.service';
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
    private readonly images: PostImagesService,
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

  /** Reaction counts of one message of the post (`?part=2`, counting from 1; default the first). */
  @Get('tasks/:id/reactions')
  async reactions(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('part') part?: string,
  ): Promise<ReactionDto[]> {
    await this.assertOfficerOfTask(req, id);
    return this.tasks.reactions(id, parsePart(part));
  }

  /** Who reacted with one emoji (`?emoji=👍`, or `name:id` for a custom one), without the bot. */
  @Get('tasks/:id/reactions/users')
  async reactionUsers(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('emoji') emoji?: string,
    @Query('part') part?: string,
  ): Promise<Reactor[]> {
    await this.assertOfficerOfTask(req, id);
    return this.tasks.reactionUsers(id, emoji, parsePart(part));
  }

  /** Uploads an image for a message of a post (PNG, JPEG, GIF or WebP, up to 5 MB). */
  @Post('guilds/:guildId/post-images')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async uploadImage(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @UploadedFile() file?: { buffer: Buffer },
  ): Promise<PostImageDto> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    if (!file) throw new BadRequestException('No image was sent.');
    return this.images.upload(guildId, file.buffer);
  }

  /** An uploaded image, for the form's preview. */
  @Get('guilds/:guildId/post-images/:imageId')
  async image(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, guildId);
    const image = await this.images.get(guildId, imageId);
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

  private async assertOfficerOfTask(req: AuthenticatedRequest, taskId: string): Promise<void> {
    await this.guildAccess.assertOfficer(req.user.id, await this.tasks.guildIdOf(taskId));
  }
}

/** `?part=2`: a message of the post, counting from 1; the first when left out. */
function parsePart(value: string | undefined): number {
  if (value === undefined || value === '') return 1;
  const part = Number(value);
  if (!Number.isInteger(part) || part < 1) throw new BadRequestException('part is not valid.');
  return part;
}
