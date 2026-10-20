import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GuildPlugin } from '@prisma/client';
import { DateTime } from 'luxon';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { PluginKindRegistry, type PluginContext } from '../plugins/plugin-kinds';
import { RecurringEventPlugin, type RecurringEventConfig } from './recurring-event.plugin';
import type { SignupEventsService } from './signup-events.service';

const SERVER = '111111111111111111';
const CHANNEL = '222222222222222222';

// Wednesday 22 October 2025, 23:00 in Paris (summer time: 21:00 UTC).
const NOW = Date.UTC(2025, 9, 22, 21, 0);

const CONFIG: RecurringEventConfig = {
  serverId: SERVER,
  channelId: CHANNEL,
  kind: 'CHARACTERS',
  title: 'Naxxramas',
  description: 'Bring flasks.',
  location: 'Naxxramas',
  weekday: 3,
  time: '20:00',
  timezone: 'ST',
};

function setup(openEvents: string[] = ['old-1'], successfulRuns = 1) {
  const archived: string[] = [];
  const created: { creator: unknown; input: Record<string, unknown>; channel: unknown }[] = [];
  const events = {
    findGuild: async () => ({ id: 'g1', region: 'EU' }),
    archive: async (id: string) => void archived.push(id),
    create: async (
      _guild: unknown,
      creator: unknown,
      input: Record<string, unknown>,
      channel: unknown,
    ) => {
      created.push({ creator, input, channel });
      return { id: 'new-1', title: input.title };
    },
  } as unknown as SignupEventsService;
  const prisma = {
    signupEvent: { findMany: async () => openEvents.map((id) => ({ id })) },
    pluginRun: { count: async () => successfulRuns },
    user: {
      findUnique: async () => ({ discordId: 'officer-1', username: 'sam', displayName: 'Sam' }),
    },
  } as unknown as PrismaService;
  const registry = new PluginKindRegistry();
  const plugin = new RecurringEventPlugin(registry, events, prisma);
  plugin.onModuleInit();
  const bot = {
    listTextChannels: async () => [{ id: CHANNEL, name: 'wednesday-raid' }],
  } as unknown as DiscordBotService;
  const context: PluginContext = { bot, guildId: 'g1', serverIds: [SERVER], clock: () => NOW };
  const run = () =>
    plugin.def.run(
      {
        id: 'p1',
        guildId: 'g1',
        createdById: 'u1',
        name: 'Wednesday raid',
        config: CONFIG,
      } as Omit<GuildPlugin, 'config'> & { config: RecurringEventConfig },
      context,
      NOW + 60_000,
    );
  return { registry, plugin, context, run, archived, created };
}

describe('RecurringEventPlugin', () => {
  it('adds itself to the plugin kinds', () => {
    const { registry } = setup();
    assert.deepEqual(
      registry.all().map((def) => def.kind),
      ['CHANNEL_CLEANUP', 'RECURRING_EVENT'],
    );
  });

  it("archives the channel's open events and posts next week's, owned by the plugin's Officer", async () => {
    const { run, archived, created } = setup(['old-1', 'old-2']);
    const outcome = await run();
    assert.deepEqual(archived, ['old-1', 'old-2']);
    assert.equal(created.length, 1);
    const [{ creator, input, channel }] = created;
    assert.deepEqual(creator, { discordId: 'officer-1', name: 'Sam' });
    assert.deepEqual(channel, { serverId: SERVER, channelId: CHANNEL });
    assert.equal(input.title, 'Naxxramas');
    assert.equal(input.timezone, 'Europe/Paris');
    // The next Wednesday 20:00 in server time, a week after the one that just ended.
    const local = DateTime.fromJSDate(input.startsAt as Date, { zone: 'Europe/Paris' });
    assert.equal(local.toFormat('yyyy-MM-dd HH:mm'), '2025-10-29 20:00');
    assert.match(outcome.result, /^Archived 2 events; posted “Naxxramas” for Wed 29 Oct, 20:00\.$/);
    assert.deepEqual(outcome.state, { lastEventId: 'new-1' });
  });

  it('archives nothing on its first post', async () => {
    const { run, archived, created } = setup(['manual-1'], 0);
    const outcome = await run();
    assert.deepEqual(archived, []);
    assert.equal(created.length, 1);
    assert.match(outcome.result, /^Posted “Naxxramas” for Wed 29 Oct, 20:00\.$/);
  });

  it('just posts when the channel has no open event', async () => {
    const { run, archived } = setup([]);
    const outcome = await run();
    assert.deepEqual(archived, []);
    assert.match(outcome.result, /^Posted “Naxxramas”/);
  });

  it('checks the form: channel, name, day, time and timezone', async () => {
    const { plugin, context } = setup();
    const parse = (changes: Record<string, unknown>) =>
      plugin.def.parseConfig({ ...CONFIG, ...changes }, context);
    assert.deepEqual(await parse({ title: '  Naxxramas  ', kind: 'nonsense' }), {
      ...CONFIG,
      kind: 'CHARACTERS',
    });
    await assert.rejects(parse({ channelId: '333333333333333333' }), /not a text channel/);
    await assert.rejects(parse({ title: ' ' }), /Give the event a name/);
    await assert.rejects(parse({ weekday: 8 }), /day of the week/);
    await assert.rejects(parse({ time: '25:00' }), /HH:mm/);
    await assert.rejects(parse({ timezone: 'Mars/Olympus' }), /Unknown timezone/);
  });
});
