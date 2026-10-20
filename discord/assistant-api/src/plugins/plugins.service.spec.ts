import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { PluginKindRegistry } from './plugin-kinds';
import { PluginsService } from './plugins.service';

/** A service whose `guildPlugin.create` hands back what it was given, in the EU (Paris). */
function setup() {
  const saved: { nextRunAt: Date | null }[] = [];
  const prisma = {
    guild: { findUnique: async () => ({ region: 'EU' }) },
    discordServer: { findMany: async () => [{ discordId: '111111111111111111' }] },
    guildPlugin: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        saved.push(data as { nextRunAt: Date | null });
        return { id: 'p1', runs: [], ...data };
      },
    },
  } as unknown as PrismaService;
  const bot = {
    listTextChannels: async () => [{ id: '222222222222222222', name: 'raids' }],
  } as unknown as DiscordBotService;
  const service = new PluginsService(prisma, bot, new PluginKindRegistry());
  const create = (firstRun?: string) =>
    service.create('g1', 'u1', {
      kind: 'CHANNEL_CLEANUP',
      confirm: true,
      scheduleKind: 'WEEKLY',
      timeOfDay: '23:00',
      weekday: 3,
      config: { serverId: '111111111111111111', channelId: '222222222222222222' },
      firstRun,
    });
  return { create, saved };
}

describe('PluginsService.create, first run', () => {
  it('runs at its schedule by default, now, or at a time picked in the guild timezone', async () => {
    const { create, saved } = setup();
    const before = Date.now();
    await create();
    await create('now');
    await create('2099-01-07T19:30');
    const [scheduled, now, picked] = saved.map((data) => data.nextRunAt!);
    assert.ok(scheduled.getTime() > before + 60_000);
    assert.ok(Math.abs(now.getTime() - before) < 5_000);
    // 19:30 in Paris in January (winter time) is 18:30 UTC.
    assert.equal(picked.toISOString(), '2099-01-07T18:30:00.000Z');
  });

  it('refuses a first run in the past', async () => {
    await assert.rejects(setup().create('2020-01-01T10:00'), /in the future/);
  });
});
