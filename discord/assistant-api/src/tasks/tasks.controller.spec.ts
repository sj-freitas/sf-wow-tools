import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { TasksController } from './tasks.controller';
import type { PostImagesService } from './post-images.service';
import type { TasksService } from './tasks.service';

const req = { user: { id: 'u1' } } as AuthenticatedRequest;

describe('TasksController is for Officers only', () => {
  let officer: boolean;
  let checkedGuilds: string[];
  let calls: string[];
  let reactionParts: number[];
  let controller: TasksController;

  beforeEach(() => {
    officer = true;
    checkedGuilds = [];
    calls = [];
    reactionParts = [];
    const check = async (_user: string, guildId: string) => {
      checkedGuilds.push(guildId);
      if (!officer) throw new ForbiddenException();
    };
    // The channel list is also for Guild-Assistants (they pick the officer request channel).
    const guildAccess = {
      assertOfficer: check,
      assertCanConfigure: check,
    } as unknown as GuildAccessService;
    const tasks = {
      guildIdOf: async () => 'guild-of-task',
      list: async () => void calls.push('list'),
      get: async () => void calls.push('get'),
      listChannels: async () => void calls.push('channels'),
      create: async () => void calls.push('create'),
      update: async () => void calls.push('update'),
      remove: async () => void calls.push('remove'),
      deletePost: async () => void calls.push('deletePost'),
      runNow: async () => void calls.push('runNow'),
      reactions: async (_id: string, part: number) => {
        calls.push('reactions');
        reactionParts.push(part);
      },
      reactionUsers: async (_id: string, _emoji: unknown, part: number) => {
        calls.push('reactionUsers');
        reactionParts.push(part);
      },
    } as unknown as TasksService;
    const images = {
      upload: async () => ({ id: 'i', contentType: 'image/png', size: 1 }),
      get: async () => null,
    } as unknown as PostImagesService;
    controller = new TasksController(tasks, guildAccess, images);
  });

  it('lets Officers do everything', async () => {
    await controller.list(req, 'g');
    await controller.channels(req, 'g');
    await controller.get(req, 't');
    await controller.create(req, 'g', {});
    await controller.update(req, 't', {});
    await controller.remove(req, 't');
    await controller.deletePost(req, 't');
    await controller.runNow(req, 't');
    await controller.reactions(req, 't');
    await controller.reactionUsers(req, 't', '👍');
    assert.deepEqual(calls, [
      'list',
      'channels',
      'get',
      'create',
      'update',
      'remove',
      'deletePost',
      'runNow',
      'reactions',
      'reactionUsers',
    ]);
  });

  it('refuses everyone else, on every route', async () => {
    officer = false;
    for (const attempt of [
      () => controller.list(req, 'g'),
      () => controller.channels(req, 'g'),
      () => controller.get(req, 't'),
      () => controller.create(req, 'g', {}),
      () => controller.update(req, 't', {}),
      () => controller.remove(req, 't'),
      () => controller.deletePost(req, 't'),
      () => controller.runNow(req, 't'),
      () => controller.reactions(req, 't'),
      () => controller.reactionUsers(req, 't', '👍'),
      () => controller.uploadImage(req, 'g', { buffer: Buffer.alloc(1) }),
      () => controller.image(req, 'g', 'i', {} as never),
    ]) {
      await assert.rejects(attempt(), ForbiddenException);
    }
    assert.deepEqual(calls, []);
  });

  it('passes the chosen message of the post to the reaction routes', async () => {
    await controller.reactions(req, 't', '2');
    await controller.reactionUsers(req, 't', '👍', '3');
    assert.deepEqual(reactionParts, [2, 3]);
    await assert.rejects(controller.reactions(req, 't', '0'), BadRequestException);
    await assert.rejects(controller.reactions(req, 't', 'x'), BadRequestException);
  });

  it('accepts an uploaded image from Officers, and needs a file', async () => {
    assert.deepEqual(await controller.uploadImage(req, 'g', { buffer: Buffer.alloc(1) }), {
      id: 'i',
      contentType: 'image/png',
      size: 1,
    });
    await assert.rejects(controller.uploadImage(req, 'g', undefined), BadRequestException);
  });

  it('answers 404 for an image that is not there', async () => {
    const sent: { status?: number } = {};
    const res: any = {
      status: (code: number) => ((sent.status = code), res),
      json: () => res,
    };
    await controller.image(req, 'g', 'i', res);
    assert.equal(sent.status, 404);
  });

  it('checks the guild the task belongs to, not one supplied by the caller', async () => {
    await controller.remove(req, 't');
    assert.deepEqual(checkedGuilds, ['guild-of-task']);
  });
});
