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

/** A message id (snowflake) from an hour before NOW, so Discord would bulk-delete it. */
const messageId = (n: number) =>
  ((BigInt(NOW - 3_600_000 - n * 1000) - 1_420_070_400_000n) << 22n).toString();

interface FakeMessage {
  id: string;
  pinned: boolean;
  bot: boolean;
}

function setup(openEvents: string[] = ['old-1'], successfulRuns = 1, messages: FakeMessage[] = []) {
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
  // The channel, newest first, read two messages at a time.
  const deletedMessages: string[] = [];
  const bot = {
    listTextChannels: async () => [{ id: CHANNEL, name: 'wednesday-raid' }],
    listMessages: async (_channel: string, before?: string) => {
      const from = before ? messages.findIndex((m) => m.id === before) + 1 : 0;
      return messages.slice(from, from + 2);
    },
    bulkDeleteMessages: async (_channel: string, ids: string[]) =>
      void deletedMessages.push(...ids),
    deleteMessage: async (_channel: string, id: string) => void deletedMessages.push(id),
  } as unknown as DiscordBotService;
  const context: PluginContext = { bot, guildId: 'g1', serverIds: [SERVER], clock: () => NOW };
  const run = (state: Record<string, unknown> = {}, deadline = NOW + 60_000) =>
    plugin.def.run(
      {
        id: 'p1',
        guildId: 'g1',
        createdById: 'u1',
        name: 'Wednesday raid',
        config: CONFIG,
        state,
      } as Omit<GuildPlugin, 'config'> & { config: RecurringEventConfig },
      context,
      deadline,
    );
  return { registry, plugin, context, run, archived, created, deletedMessages };
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

  it("deletes all the channel's messages before posting, pinned and bots' too", async () => {
    const messages = [
      { id: messageId(1), pinned: false, bot: false },
      { id: messageId(2), pinned: true, bot: false },
      { id: messageId(3), pinned: false, bot: true },
      { id: messageId(4), pinned: false, bot: false },
    ];
    const { run, deletedMessages, created } = setup(['old-1'], 1, messages);
    const outcome = await run();
    assert.deepEqual([...deletedMessages].sort(), messages.map((m) => m.id).sort());
    assert.equal(created.length, 1);
    assert.match(outcome.result, /^Archived 1 event, deleted 4 messages; posted “Naxxramas”/);
  });

  it('carries on clearing a big channel over several runs, then posts', async () => {
    const messages = [1, 2, 3].map((n) => ({ id: messageId(n), pinned: false, bot: false }));
    const { run, created, deletedMessages } = setup(['old-1'], 1, messages);
    // Out of time at once: nothing posted yet, and it asks to carry on.
    const first = await run({}, NOW);
    assert.equal(first.more, true);
    assert.equal(created.length, 0);
    const second = await run(first.state);
    assert.equal(second.more, undefined);
    assert.equal(deletedMessages.length, 3);
    assert.equal(created.length, 1);
  });

  it('archives and deletes nothing on its first post', async () => {
    const messages = [{ id: messageId(1), pinned: false, bot: false }];
    const { run, archived, created, deletedMessages } = setup(['manual-1'], 0, messages);
    const outcome = await run();
    assert.deepEqual(archived, []);
    assert.deepEqual(deletedMessages, []);
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
