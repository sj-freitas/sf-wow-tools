import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { MAX_ATTEMPTS, RETRY_DELAY_MS, TaskRunnerService } from './task-runner.service';

const NOW = new Date('2026-10-05T18:00:30Z');

const baseTask = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 't1',
    guildId: 'g',
    name: 'Weekly reminder',
    type: 'POST',
    enabled: true,
    scheduleKind: 'DAILY',
    runAt: null,
    timeOfDay: '20:00',
    weekday: null,
    nextRunAt: new Date('2026-10-05T18:00:00Z'),
    config: { serverId: 's', channelId: 'c', content: 'Hello', seedReactions: ['👍', '👎'] },
    state: {},
    ...overrides,
  }) as any;

describe('TaskRunnerService', () => {
  let region: string;
  let failPost: boolean;
  let failReaction: boolean;
  let recentFailures: number;
  let posted: any[];
  let reactions: string[];
  let runs: any[];
  let missed: any[];
  let update: any;
  let runner: TaskRunnerService;

  beforeEach(() => {
    region = 'EU';
    failPost = false;
    failReaction = false;
    recentFailures = 0;
    posted = [];
    reactions = [];
    runs = [];
    missed = [];
    update = null;
    const prisma = {
      guild: { findUnique: async () => ({ region }) },
      taskRun: {
        upsert: async (args: any) => void runs.push(args.create),
        createMany: async (args: any) => void missed.push(...args.data),
        count: async () => recentFailures + 1,
      },
      scheduledTask: { update: async (args: any) => void (update = args.data) },
    } as unknown as PrismaService;
    const bot = {
      postMessage: async (channelId: string, content: string) => {
        if (failPost) throw new Error('Missing Permissions');
        posted.push({ channelId, content });
        return 'msg1';
      },
      addReaction: async (_c: string, _m: string, emoji: string) => {
        if (failReaction) throw new Error('nope');
        reactions.push(emoji);
      },
    } as unknown as DiscordBotService;
    runner = new TaskRunnerService(prisma, bot);
  });

  describe('a successful run', () => {
    it('posts the message, adds the seed reactions and remembers the post', async () => {
      await runner.run(baseTask(), NOW);
      assert.deepEqual(posted, [{ channelId: 'c', content: 'Hello' }]);
      assert.deepEqual(reactions, ['👍', '👎']);
      assert.equal(update.state.messageId, 'msg1');
      assert.equal(update.state.channelId, 'c');
      assert.equal(update.lastStatus, 'SUCCESS');
      assert.equal(update.lastError, null);
      assert.equal(update.leaseUntil, null);
    });

    it('records the run for the occurrence it was due for', async () => {
      await runner.run(baseTask(), NOW);
      assert.equal(runs[0].scheduledFor.toISOString(), '2026-10-05T18:00:00.000Z');
      assert.equal(runs[0].status, 'SUCCESS');
    });

    it('schedules a recurring task for its next occurrence (Paris, next day 20:00)', async () => {
      await runner.run(baseTask(), NOW);
      assert.equal(update.nextRunAt.toISOString(), '2026-10-06T18:00:00.000Z');
    });

    it('uses the guild region timezone (US Pacific)', async () => {
      region = 'US';
      await runner.run(
        baseTask({ timeOfDay: '09:00', nextRunAt: new Date('2026-10-05T16:00:00Z') }),
        new Date('2026-10-05T16:00:30Z'),
      );
      assert.equal(update.nextRunAt.toISOString(), '2026-10-06T16:00:00.000Z');
    });

    it('finishes a one-time task', async () => {
      await runner.run(
        baseTask({
          scheduleKind: 'ONCE',
          runAt: new Date('2026-10-05T18:00:00Z'),
          timeOfDay: null,
        }),
        NOW,
      );
      assert.equal(update.nextRunAt, null);
      assert.equal(update.lastStatus, 'SUCCESS');
    });

    it('does not fail the run, or re-post, when a seed reaction cannot be added', async () => {
      failReaction = true;
      await runner.run(baseTask(), NOW);
      assert.equal(posted.length, 1);
      assert.equal(update.lastStatus, 'SUCCESS');
    });
  });

  describe('catching up after a delay (missed runs are never dropped)', () => {
    it('runs an overdue task, once, and records the skipped occurrences as missed', async () => {
      const overdue = baseTask({ nextRunAt: new Date('2026-10-02T18:00:00Z') });
      await runner.run(overdue, NOW);
      assert.equal(posted.length, 1);
      assert.deepEqual(
        missed.map((run) => run.scheduledFor.toISOString()),
        ['2026-10-03T18:00:00.000Z', '2026-10-04T18:00:00.000Z', '2026-10-05T18:00:00.000Z'],
      );
      assert.ok(missed.every((run) => run.status === 'MISSED'));
      assert.equal(update.nextRunAt.toISOString(), '2026-10-06T18:00:00.000Z');
    });

    it('records nothing as missed when on time', async () => {
      await runner.run(baseTask(), NOW);
      assert.deepEqual(missed, []);
    });

    it('runs an overdue one-time task, late rather than never', async () => {
      const late = baseTask({
        scheduleKind: 'ONCE',
        runAt: new Date('2026-10-01T18:00:00Z'),
        nextRunAt: new Date('2026-10-01T18:00:00Z'),
        timeOfDay: null,
      });
      await runner.run(late, NOW);
      assert.equal(posted.length, 1);
      assert.equal(update.nextRunAt, null);
    });
  });

  describe('one message per post', () => {
    it('refuses to post again while the previous message is live', async () => {
      await runner.run(baseTask({ state: { messageId: 'm0', channelId: 'c' } }), NOW);
      assert.equal(posted.length, 0);
      assert.equal(update.lastStatus, 'FAILED');
      assert.match(update.lastError, /already in Discord/);
    });

    it('posts again when the previous message was deleted', async () => {
      await runner.run(
        baseTask({ state: { messageId: 'm0', channelId: 'c', messageDeleted: true } }),
        NOW,
      );
      assert.equal(posted.length, 1);
      assert.equal(update.state.messageId, 'msg1');
    });
  });

  describe('a failed run', () => {
    beforeEach(() => {
      failPost = true;
    });

    it('is recorded with a readable reason and not marked as posted', async () => {
      await runner.run(baseTask(), NOW);
      assert.equal(update.lastStatus, 'FAILED');
      assert.match(update.lastError, /Missing Permissions/);
      assert.equal(runs[0].status, 'FAILED');
      assert.deepEqual(update.state, {});
    });

    it('is retried a few minutes later', async () => {
      await runner.run(baseTask(), NOW);
      assert.equal(update.nextRunAt.getTime(), NOW.getTime() + RETRY_DELAY_MS);
    });

    it('gives up after the maximum number of attempts and moves on', async () => {
      recentFailures = MAX_ATTEMPTS - 1;
      await runner.run(baseTask(), NOW);
      assert.equal(update.nextRunAt.toISOString(), '2026-10-06T18:00:00.000Z');
    });

    it('gives up on a one-time task after the maximum number of attempts', async () => {
      recentFailures = MAX_ATTEMPTS - 1;
      await runner.run(
        baseTask({
          scheduleKind: 'ONCE',
          runAt: new Date('2026-10-05T18:00:00Z'),
          timeOfDay: null,
        }),
        NOW,
      );
      assert.equal(update.nextRunAt, null);
      assert.equal(update.lastStatus, 'FAILED');
    });
  });
});
