import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { GuildPlugin } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { nextOccurrence } from '../tasks/schedule';
import { PluginRunnerService, RUN_BUDGET_MS } from './plugin-runner.service';
import { PluginsService } from './plugins.service';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.now();
/** The next 02:00 in Paris after now: when a daily 02:00 clean-up runs next. */
const next0200 = () =>
  nextOccurrence({ kind: 'DAILY', timeOfDay: '02:00' }, 'Europe/Paris', new Date())!.toISOString();
const messageId = (ageMs: number, n: number): string =>
  String(((BigInt(BASE - ageMs) - 1_420_070_400_000n) << 22n) + BigInt(n));

describe('PluginRunnerService', () => {
  let plugin: GuildPlugin;
  let updates: Record<string, unknown>[];
  let runs: Record<string, unknown>[];
  let failures: number;
  let pages: { id: string; pinned: boolean; bot: boolean }[][];
  let listFails: boolean;
  let runner: PluginRunnerService;

  beforeEach(() => {
    plugin = {
      id: 'plugin-1',
      guildId: 'guild-1',
      kind: 'CHANNEL_CLEANUP',
      name: 'Raid channel',
      enabled: true,
      scheduleKind: 'DAILY',
      timeOfDay: '02:00',
      weekday: null,
      dayOfMonth: null,
      nextRunAt: new Date('2026-11-03T01:00:00Z'),
      leaseUntil: new Date(),
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      lastResult: null,
      config: { serverId: '1', channelId: '2', keepBotMessages: true },
      state: {},
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    updates = [];
    runs = [];
    failures = 0;
    pages = [];
    listFails = false;
    const prisma = {
      guild: { findUnique: async () => ({ region: 'EU' }) },
      discordServer: { findMany: async () => [{ discordId: '1' }] },
      pluginRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => void runs.push(data),
        count: async () => failures,
      },
      guildPlugin: {
        update: async ({ data }: { data: Record<string, unknown> }) => void updates.push(data),
      },
    } as unknown as PrismaService;
    const bot = {
      listMessages: async () => {
        if (listFails) throw new Error('Missing Access');
        return pages.shift() ?? [];
      },
      bulkDeleteMessages: async () => undefined,
      deleteMessage: async () => undefined,
    } as unknown as DiscordBotService;
    runner = new PluginRunnerService(prisma, new PluginsService(prisma, bot));
  });

  it('cleans the channel, keeping bot messages, and waits for the next occurrence', async () => {
    pages = [
      [
        { id: messageId(DAY, 1), pinned: false, bot: false },
        { id: messageId(DAY, 2), pinned: false, bot: true },
        { id: messageId(DAY, 3), pinned: false, bot: false },
      ],
    ];
    const now = new Date('2026-11-03T01:00:30Z');
    await runner.run(plugin, now);
    assert.equal(runs[0].status, 'SUCCESS');
    assert.equal(runs[0].result, 'Deleted 2 messages.');
    const update = updates[0];
    assert.equal(update.lastResult, 'Deleted 2 messages.');
    assert.equal(update.leaseUntil, null);
    assert.deepEqual(update.state, {});
    // Every day at 02:00 Paris time, counted from when the run finished.
    assert.equal((update.nextRunAt as Date).toISOString(), next0200());
  });

  it('carries on a minute later from where it stopped when out of time', async () => {
    // The budget is spent before the first page: nothing is listed, the place is kept.
    plugin.state = { cursor: messageId(DAY, 9), deletedSoFar: 150 };
    const now = new Date(Date.now() - RUN_BUDGET_MS - 1000);
    await runner.run(plugin, now);
    const update = updates[0];
    assert.deepEqual(update.state, { cursor: messageId(DAY, 9), deletedSoFar: 150 });
    assert.equal(update.lastResult, 'Deleted 150 messages so far; carrying on.');
    const wait = (update.nextRunAt as Date).getTime() - Date.now();
    assert.ok(wait > 50_000 && wait <= 60_000, `carries on in a minute, not ${wait}ms`);
  });

  it('records a failure and tries again in 5 minutes, then waits for the next occurrence', async () => {
    listFails = true;
    await runner.run(plugin, new Date('2026-11-03T01:00:30Z'));
    assert.equal(runs[0].status, 'FAILED');
    assert.equal(updates[0].lastStatus, 'FAILED');
    const retryIn = (updates[0].nextRunAt as Date).getTime() - Date.now();
    assert.ok(
      retryIn > 4 * 60_000 && retryIn <= 5 * 60_000,
      `retries in 5 minutes, not ${retryIn}`,
    );

    failures = 3;
    await runner.run(plugin, new Date('2026-11-03T01:00:30Z'));
    assert.equal((updates[1].nextRunAt as Date).toISOString(), next0200());
  });
});
