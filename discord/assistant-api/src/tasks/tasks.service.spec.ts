import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiscordAPIError } from '@discordjs/rest';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { TasksService } from './tasks.service';

const CHANNEL = '333333333333333333';
const SERVER = '222222222222222222';
const unknownMessage = () =>
  new DiscordAPIError({ message: 'Unknown Message', code: 10008 }, 10008, 404, 'PATCH', 'u', {});

const validInput = {
  name: 'Weekly reminder',
  kind: 'WEEKLY',
  weekday: 2,
  timeOfDay: '20:00',
  serverId: SERVER,
  channelId: CHANNEL,
  content: 'Raid tonight',
  seedReactions: ['👍'],
};

describe('TasksService', () => {
  let task: any;
  let created: any;
  let updated: any;
  let serverInGuild: boolean;
  let channelsInServer: { id: string; name: string }[];
  let edits: any[];
  let editError: Error | null;
  let deletedMessages: unknown[][];
  let deleteError: Error | null;
  let removed: boolean;
  let reactionsResult: any[];
  let service: TasksService;

  beforeEach(() => {
    serverInGuild = true;
    channelsInServer = [{ id: CHANNEL, name: 'announcements' }];
    created = null;
    updated = null;
    edits = [];
    editError = null;
    deletedMessages = [];
    deleteError = null;
    removed = false;
    reactionsResult = [{ emoji: '👍', emojiId: null, count: 3 }];
    task = {
      id: 't1',
      guildId: 'g',
      name: 'Weekly reminder',
      type: 'POST',
      enabled: true,
      scheduleKind: 'WEEKLY',
      runAt: null,
      timeOfDay: '20:00',
      weekday: 2,
      nextRunAt: new Date('2026-10-06T18:00:00Z'),
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      config: {
        serverId: SERVER,
        channelId: CHANNEL,
        content: 'Raid tonight',
        seedReactions: ['👍'],
      },
      state: {
        messageId: 'm1',
        channelId: CHANNEL,
        serverId: SERVER,
        postedAt: '2026-10-01T18:00:00Z',
      },
      createdAt: new Date(),
    };
    const prisma = {
      guild: { findUnique: async () => ({ region: 'EU' }) },
      discordServer: { findFirst: async () => (serverInGuild ? { id: 'row' } : null) },
      scheduledTask: {
        findUnique: async () => task,
        findMany: async () => [task],
        create: async (args: any) => {
          created = args.data;
          return { ...task, ...args.data, id: 'new' };
        },
        update: async (args: any) => {
          updated = args.data;
          return { ...task, ...args.data };
        },
        delete: async () => void (removed = true),
      },
    } as unknown as PrismaService;
    const bot = {
      listTextChannels: async () => channelsInServer,
      editMessage: async (...args: unknown[]) => {
        if (editError) throw editError;
        edits.push(args);
      },
      getReactions: async () => reactionsResult,
      deleteMessage: async (...args: unknown[]) => {
        if (deleteError) throw deleteError;
        deletedMessages.push(args);
      },
    } as unknown as DiscordBotService;
    service = new TasksService(prisma, bot);
  });

  describe('create', () => {
    it('creates a task and schedules its first run in the guild timezone', async () => {
      const dto = await service.create('g', 'u', validInput);
      assert.equal(created.type, 'POST');
      assert.equal(created.scheduleKind, 'WEEKLY');
      assert.equal(created.createdById, 'u');
      assert.ok(created.nextRunAt > new Date());
      assert.equal(dto.schedule.description, 'Every Tuesday at 20:00');
      assert.equal(dto.timezone, 'Europe/Paris');
    });

    it('does not schedule a disabled task', async () => {
      await service.create('g', 'u', { ...validInput, enabled: false });
      assert.equal(created.nextRunAt, null);
    });

    it('rejects a server that is not part of the guild', async () => {
      serverInGuild = false;
      await assert.rejects(service.create('g', 'u', validInput), /not part of this guild/);
      assert.equal(created, null);
    });

    it('rejects a channel that is not in that server', async () => {
      channelsInServer = [];
      await assert.rejects(service.create('g', 'u', validInput), /not in the chosen server/);
    });

    it('rejects a one-time task in the past and bad schedules', async () => {
      await assert.rejects(
        service.create('g', 'u', { ...validInput, kind: 'ONCE', runAtLocal: '2020-01-01T20:00' }),
        /future/,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, timeOfDay: '25:00' }),
        BadRequestException,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, kind: 'HOURLY' }),
        BadRequestException,
      );
    });

    it('rejects missing name or text', async () => {
      await assert.rejects(
        service.create('g', 'u', { ...validInput, name: ' ' }),
        BadRequestException,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, content: '' }),
        BadRequestException,
      );
    });

    it('reads a one-time date as wall-clock time in the guild timezone', async () => {
      await service.create('g', 'u', {
        ...validInput,
        kind: 'ONCE',
        runAtLocal: '2099-10-01T20:00',
      });
      assert.equal(created.runAt.toISOString(), '2099-10-01T18:00:00.000Z');
      assert.equal(created.nextRunAt.toISOString(), '2099-10-01T18:00:00.000Z');
    });
  });

  describe('live edit', () => {
    it('edits the Discord message when the text changes', async () => {
      await service.update('t1', { content: 'Raid moved to 21:00' });
      assert.deepEqual(edits, [[CHANNEL, 'm1', 'Raid moved to 21:00']]);
      assert.equal(updated.config.content, 'Raid moved to 21:00');
    });

    it('leaves the message alone, but saves the text, when the change is for the next run', async () => {
      await service.update('t1', { content: 'For next week', applyOnNextRun: true });
      assert.deepEqual(edits, []);
      assert.equal(updated.config.content, 'For next week');
      assert.equal('nextRunAt' in updated, false);
    });

    it('does not touch Discord when the text is unchanged', async () => {
      await service.update('t1', { name: 'Renamed', content: 'Raid tonight' });
      assert.deepEqual(edits, []);
      assert.equal(updated.name, 'Renamed');
    });

    it('does not touch Discord when nothing was posted yet', async () => {
      task.state = {};
      await service.update('t1', { content: 'New text' });
      assert.deepEqual(edits, []);
    });

    it('still saves when the message was deleted in Discord, and marks it', async () => {
      editError = unknownMessage();
      await service.update('t1', { content: 'New text' });
      assert.equal(updated.state.messageDeleted, true);
      assert.equal(updated.config.content, 'New text');
    });

    it('saves nothing when Discord refuses for another reason', async () => {
      editError = new Error('Missing Permissions');
      await assert.rejects(
        service.update('t1', { content: 'New text' }),
        /Could not update the post in Discord/,
      );
      assert.equal(updated, null);
    });
  });

  describe('scheduling changes', () => {
    it('reschedules when the schedule changes', async () => {
      await service.update('t1', { kind: 'DAILY', timeOfDay: '08:00' });
      assert.equal(updated.scheduleKind, 'DAILY');
      assert.ok(updated.nextRunAt instanceof Date);
    });

    it('keeps the next run when only the text changes', async () => {
      await service.update('t1', { content: 'x' });
      assert.equal('nextRunAt' in updated, false);
    });

    it('clears the next run when disabled and restores it when enabled again', async () => {
      await service.update('t1', { enabled: false });
      assert.equal(updated.nextRunAt, null);
      task.enabled = false;
      await service.update('t1', { enabled: true });
      assert.ok(updated.nextRunAt instanceof Date);
    });
  });

  describe('run now', () => {
    it('makes an enabled task due immediately', async () => {
      await service.runNow('t1');
      assert.ok(updated.nextRunAt instanceof Date && updated.nextRunAt <= new Date());
    });

    it('refuses a disabled task', async () => {
      task.enabled = false;
      await assert.rejects(service.runNow('t1'), /Enable the task first/);
    });
  });

  describe('reactions', () => {
    it('returns the live counts of the current post', async () => {
      assert.deepEqual(await service.reactions('t1'), [
        { emoji: '👍', emojiId: null, count: 3, imageUrl: null },
      ]);
    });

    it('returns nothing before the first post', async () => {
      task.state = {};
      assert.deepEqual(await service.reactions('t1'), []);
    });
  });

  it('404s for unknown tasks', async () => {
    task = null;
    await assert.rejects(service.remove('nope'), NotFoundException);
  });

  describe('delete post (removes the message, keeps the task)', () => {
    it('deletes the Discord message and marks the task’s post as deleted', async () => {
      await service.deletePost('t1');
      assert.deepEqual(deletedMessages, [[CHANNEL, 'm1']]);
      assert.equal(updated.state.messageDeleted, true);
      assert.equal(updated.state.messageId, 'm1');
      assert.equal(removed, false);
    });

    it('leaves the schedule alone so it can be posted again', async () => {
      await service.deletePost('t1');
      assert.equal('nextRunAt' in updated, false);
      assert.equal('enabled' in updated, false);
    });

    it('treats a message that is already gone as deleted', async () => {
      deleteError = unknownMessage();
      await service.deletePost('t1');
      assert.equal(updated.state.messageDeleted, true);
    });

    it('changes nothing when Discord refuses', async () => {
      deleteError = new Error('Missing Permissions');
      await assert.rejects(service.deletePost('t1'), /Could not delete the post in Discord/);
      assert.equal(updated, null);
    });

    it('refuses when there is no post in Discord', async () => {
      task.state = {};
      await assert.rejects(service.deletePost('t1'), /no post in Discord/);
      task.state = { messageId: 'm1', channelId: CHANNEL, messageDeleted: true };
      await assert.rejects(service.deletePost('t1'), /no post in Discord/);
      assert.deepEqual(deletedMessages, []);
    });
  });

  describe('untrack (removes the task, keeps the message)', () => {
    it('removes the task without touching the Discord message', async () => {
      await service.remove('t1');
      assert.equal(removed, true);
      assert.deepEqual(deletedMessages, []);
    });
  });

  describe('rescheduling after the post went out', () => {
    beforeEach(() => {
      task.scheduleKind = 'ONCE';
      task.runAt = new Date('2020-01-01T18:00:00Z');
      task.timeOfDay = null;
      task.weekday = null;
      task.nextRunAt = null;
    });

    it('lets a finished one-time post be edited without picking a new date', async () => {
      await service.update('t1', { kind: 'ONCE', runAtLocal: '2020-01-01T19:00', name: 'Renamed' });
      assert.equal(updated.name, 'Renamed');
      assert.equal('nextRunAt' in updated, false);
    });

    it('reschedules it when a new future date is picked', async () => {
      await service.update('t1', { kind: 'ONCE', runAtLocal: '2099-10-01T20:00' });
      assert.equal(updated.nextRunAt.toISOString(), '2099-10-01T18:00:00.000Z');
    });

    it('still rejects a new date in the past', async () => {
      await assert.rejects(
        service.update('t1', { kind: 'ONCE', runAtLocal: '2021-01-01T20:00' }),
        /future/,
      );
    });
  });

  it('does not reschedule when the form sends the same schedule again', async () => {
    await service.update('t1', { kind: 'WEEKLY', weekday: 2, timeOfDay: '20:00', name: 'Renamed' });
    assert.equal('nextRunAt' in updated, false);
  });
});
