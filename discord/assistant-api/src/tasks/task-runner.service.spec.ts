import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import type { PostImagesService } from './post-images.service';
import { PostSenderService } from './post-sender.service';
import type { TrackingService } from './tracking.service';
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
    config: {
      serverId: 's',
      channelId: 'c',
      parts: [part('p1', 'Hello', { seedReactions: ['👍', '👎'] })],
    },
    state: {},
    ...overrides,
  }) as any;

/** A message of a post. */
const part = (id: string, content: string, over: Record<string, unknown> = {}) => ({
  id,
  content,
  seedReactions: [] as string[],
  embedLinks: true,
  delaySeconds: 0,
  imageIds: [] as string[],
  ...over,
});

const SOURCE = '11111111-2222-3333-4444-555555555555';

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
  let saves: any[];
  let slept: number[];
  let postCount: number;
  let failPostAt: number | null;
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
    saves = [];
    slept = [];
    postCount = 0;
    failPostAt = null;
    const prisma = {
      guild: { findUnique: async () => ({ region }) },
      taskRun: {
        upsert: async (args: any) => void runs.push(args.create),
        createMany: async (args: any) => void missed.push(...args.data),
        count: async () => recentFailures + 1,
      },
      scheduledTask: {
        update: async (args: any) => {
          update = { ...(update ?? {}), ...args.data };
          saves.push(args.data);
        },
      },
    } as unknown as PrismaService;
    const bot = {
      postMessage: async (
        channelId: string,
        content: string,
        options: { suppressEmbeds?: boolean; files?: { name: string }[] } = {},
      ) => {
        postCount++;
        if (failPost || failPostAt === postCount) throw new Error('Missing Permissions');
        posted.push({
          channelId,
          content,
          suppressEmbeds: options.suppressEmbeds,
          files: (options.files ?? []).map((file) => file.name),
        });
        return `msg${posted.length}`;
      },
      addReaction: async (_c: string, _m: string, emoji: string) => {
        if (failReaction) throw new Error('nope');
        reactions.push(emoji);
      },
    } as unknown as DiscordBotService;
    const tracking = {
      sourceMap: async () => new Map([[`name:raid signup#1`, { taskId: SOURCE, part: 1 }]]),
      rosterOf: async () => undefined,
      fetchPeople: async () => new Map([[`name:raid signup#1|👍`, [{ id: '1', name: 'Ana' }]]]),
    } as unknown as TrackingService;
    const images = {
      files: async (ids: string[]) =>
        ids.map((id, i) => ({
          name: `image-${i + 1}.png`,
          data: Buffer.alloc(1),
          contentType: id,
        })),
    } as unknown as PostImagesService;
    runner = new TaskRunnerService(prisma, new PostSenderService(bot, tracking, images));
    runner.sleep = async (ms) => void slept.push(ms);
  });

  describe('dynamic reactions', () => {
    it('fills in who reacted when the post goes out, and remembers what was posted', async () => {
      const task = baseTask();
      task.config.parts[0].content = `Going: {{reactions sourcePost="Raid signup" emoji=👍 show="reactions.map(r => r.name)"}}`;
      await runner.run(task, NOW);
      assert.equal(posted[0].content, 'Going: Ana');
      assert.equal(update.state.messages[0].renderedContent, 'Going: Ana');
    });
  });

  describe('the guild roster', () => {
    it('fills in {{roster …}} tags when the message goes out', async () => {
      const task = baseTask();
      task.config.parts[0].content = 'Members: {{roster show="roster.length"}}';
      (runner as any).sender.tracking.rosterOf = async (_guild: string, content: string) => ({
        tokens: [{ raw: content.slice(9), expression: 'roster.length' }],
        entries: [{}, {}, {}],
      });
      await runner.run(task, NOW);
      assert.equal(posted[0].content, 'Members: 3');
    });
  });

  describe('link previews', () => {
    it('are shown unless the message says otherwise', async () => {
      await runner.run(baseTask(), NOW);
      assert.equal(posted[0].suppressEmbeds, false);
    });

    it('are hidden when the post says so', async () => {
      const task = baseTask();
      task.config.parts[0].embedLinks = false;
      await runner.run(task, NOW);
      assert.equal(posted[0].suppressEmbeds, true);
    });
  });

  describe('a successful run', () => {
    it('posts the message, adds the seed reactions and remembers the post', async () => {
      await runner.run(baseTask(), NOW);
      assert.deepEqual(posted, [
        { channelId: 'c', content: 'Hello', suppressEmbeds: false, files: [] },
      ]);
      assert.deepEqual(reactions, ['👍', '👎']);
      assert.equal(update.state.messages[0].messageId, 'msg1');
      assert.equal(update.state.messages[0].channelId, 'c');
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

  describe('one copy of each message', () => {
    const posted1 = (over: Record<string, unknown> = {}) => ({
      partId: 'p1',
      messageId: 'm0',
      channelId: 'c',
      serverId: 's',
      postedAt: '2026-10-01T18:00:00.000Z',
      renderedContent: 'Hello',
      imageIds: [],
      embedLinks: true,
      ...over,
    });

    it('refuses to post again while every message is live', async () => {
      await runner.run(baseTask({ state: { messages: [posted1()] } }), NOW);
      assert.equal(posted.length, 0);
      assert.equal(update.lastStatus, 'FAILED');
      assert.match(update.lastError, /already in Discord/);
    });

    it('posts again when the previous message was deleted', async () => {
      await runner.run(baseTask({ state: { messages: [posted1({ deleted: true })] } }), NOW);
      assert.equal(posted.length, 1);
      assert.deepEqual(
        update.state.messages.map((m: any) => m.messageId),
        ['msg1'],
      );
    });
  });

  describe('a sequence of messages', () => {
    const sequence = (delays: number[] = [0, 0, 0]) =>
      baseTask({
        config: {
          serverId: 's',
          channelId: 'c',
          parts: delays.map((delaySeconds, i) =>
            part(`p${i + 1}`, `Message ${i + 1}`, {
              delaySeconds,
              seedReactions: i === 1 ? ['✅'] : [],
              embedLinks: i !== 2,
              imageIds: i === 0 ? ['image-a', 'image-b'] : [],
            }),
          ),
        },
      });

    it('sends the messages one after the other, in order, each with its own settings', async () => {
      await runner.run(sequence(), NOW);
      assert.deepEqual(
        posted.map((p) => [p.content, p.suppressEmbeds, p.files]),
        [
          ['Message 1', false, ['image-1.png', 'image-2.png']],
          ['Message 2', false, []],
          ['Message 3', true, []],
        ],
      );
      assert.deepEqual(reactions, ['✅']);
      assert.deepEqual(
        update.state.messages.map((m: any) => [m.partId, m.messageId]),
        [
          ['p1', 'msg1'],
          ['p2', 'msg2'],
          ['p3', 'msg3'],
        ],
      );
      assert.equal(update.lastStatus, 'SUCCESS');
    });

    it('waits the chosen seconds before a message, but never before the first', async () => {
      await runner.run(sequence([15, 10, 0]), NOW);
      assert.deepEqual(slept, [10000]);
    });

    it('keeps what was sent when a later message fails, and says which went wrong', async () => {
      failPostAt = 3;
      await runner.run(sequence(), NOW);
      assert.equal(posted.length, 2);
      assert.equal(update.lastStatus, 'FAILED');
      assert.deepEqual(
        update.state.messages.map((m: any) => m.partId),
        ['p1', 'p2'],
      );
    });

    it('retries by sending only the messages that are missing', async () => {
      const task = sequence();
      task.state = {
        messages: [1, 2].map((n) => ({
          partId: `p${n}`,
          messageId: `old${n}`,
          channelId: 'c',
          serverId: 's',
          postedAt: '2026-10-05T18:00:00.000Z',
          renderedContent: `Message ${n}`,
          imageIds: [],
          embedLinks: true,
        })),
      };
      await runner.run(task, NOW);
      assert.deepEqual(
        posted.map((p) => p.content),
        ['Message 3'],
      );
      assert.deepEqual(
        update.state.messages.map((m: any) => m.messageId),
        ['old1', 'old2', 'msg1'],
      );
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
      assert.deepEqual(update.state.messages ?? [], []);
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
