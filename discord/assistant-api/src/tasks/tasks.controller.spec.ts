import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { TasksController } from './tasks.controller';
import type { TasksService } from './tasks.service';

const req = { user: { id: 'u1' } } as AuthenticatedRequest;

describe('TasksController is for Officers only', () => {
  let officer: boolean;
  let checkedGuilds: string[];
  let calls: string[];
  let controller: TasksController;

  beforeEach(() => {
    officer = true;
    checkedGuilds = [];
    calls = [];
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
      reactions: async () => void calls.push('reactions'),
    } as unknown as TasksService;
    controller = new TasksController(tasks, guildAccess);
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
    ]) {
      await assert.rejects(attempt(), ForbiddenException);
    }
    assert.deepEqual(calls, []);
  });

  it('checks the guild the task belongs to, not one supplied by the caller', async () => {
    await controller.remove(req, 't');
    assert.deepEqual(checkedGuilds, ['guild-of-task']);
  });
});
