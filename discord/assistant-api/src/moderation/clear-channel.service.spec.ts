import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { CLEAR_MESSAGES, ClearChannelService } from './clear-channel.service';

const SERVER = '111111111111111111';
const CHANNEL = '333333333333333333';
const OFFICER_ROLE = 'officer-role';
const DAY = 24 * 60 * 60 * 1000;

/** A message id created `ageMs` ago; `n` keeps ids unique. */
const messageId = (ageMs: number, n: number): string =>
  String(((BigInt(Date.now() - ageMs) - 1_420_070_400_000n) << 22n) + BigInt(n));

describe('ClearChannelService', () => {
  let guild: any;
  let roles: string[];
  let pages: { id: string; pinned: boolean }[][];
  let listCalls: (string | undefined)[];
  let bulk: string[][];
  let single: string[];
  let listFails: boolean;
  let reports: string[];
  let service: ClearChannelService;

  const invoker = () => ({ id: 'officer-1', roleIds: [OFFICER_ROLE] });
  const run = async (input: Partial<Parameters<ClearChannelService['start']>[0]> = {}) => {
    const started = await service.start(
      { serverId: SERVER, channelId: CHANNEL, invoker: invoker(), ...input },
      async (text) => void reports.push(text),
    );
    await started.done;
    return started;
  };

  beforeEach(() => {
    guild = { officerRoleId: OFFICER_ROLE, servers: [{ discordId: SERVER }] };
    roles = [];
    pages = [];
    listCalls = [];
    bulk = [];
    single = [];
    listFails = false;
    reports = [];
    const prisma = {
      guild: { findFirst: async () => guild },
    } as unknown as PrismaService;
    const bot = {
      listTextChannels: async () => [{ id: CHANNEL, name: 'general' }],
      fetchMemberRoles: async () => roles,
      listMessages: async (_channel: string, before?: string) => {
        if (listFails) throw new Error('Missing Access');
        listCalls.push(before);
        return pages.shift() ?? [];
      },
      bulkDeleteMessages: async (_channel: string, ids: string[]) => void bulk.push(ids),
      deleteMessage: async (_channel: string, id: string) => void single.push(id),
    } as unknown as DiscordBotService;
    service = new ClearChannelService(prisma, bot);
  });

  it('bounces people without the Officer role, without touching anything', async () => {
    const { reply, done } = await run({ invoker: { id: 'm', roleIds: ['member'] } });
    assert.equal(reply, CLEAR_MESSAGES.notOfficer);
    assert.equal(done, undefined);
    assert.deepEqual([listCalls, bulk, single], [[], [], []]);
  });

  it('bounces everyone when the guild has no Officer role', async () => {
    guild.officerRoleId = null;
    assert.equal((await run()).reply, CLEAR_MESSAGES.notOfficer);
  });

  it('looks the role up in the main server when used from another server', async () => {
    guild.servers = [{ discordId: '999' }];
    roles = [];
    assert.equal((await run()).reply, CLEAR_MESSAGES.notOfficer);
    roles = [OFFICER_ROLE];
    assert.match((await run()).reply, /Clearing/);
  });

  it('only works in a server, and in a text channel of that server', async () => {
    assert.equal((await run({ serverId: undefined })).reply, CLEAR_MESSAGES.serverOnly);
    assert.equal((await run({ channelId: '555' })).reply, CLEAR_MESSAGES.notInServer);
    assert.equal((await run({ serverId: '222', invoker: null })).reply, CLEAR_MESSAGES.serverOnly);
  });

  it('deletes unpinned messages, keeps pinned ones and pages past them', async () => {
    const [a, b, c, pinned] = [1, 2, 3, 4].map((n) => messageId(DAY, n));
    pages = [
      [
        { id: a, pinned: false },
        { id: pinned, pinned: true },
        { id: b, pinned: false },
      ],
      [{ id: c, pinned: false }],
    ];
    await run();
    assert.deepEqual(bulk, [[a, b]]);
    assert.deepEqual(single, [c]); // a lone message is deleted on its own
    assert.deepEqual(listCalls, [undefined, b, c]);
    assert.match(reports[0], /3 messages deleted\. Pinned messages were kept/);
  });

  it('deletes messages older than 14 days one by one', async () => {
    const old = [1, 2].map((n) => messageId(20 * DAY, n));
    const fresh = [3, 4].map((n) => messageId(DAY, n));
    pages = [[...fresh, ...old].map((id) => ({ id, pinned: false }))];
    await run();
    assert.deepEqual(bulk, [fresh]);
    assert.deepEqual(single, old);
  });

  it('keeps going when a message cannot be deleted', async () => {
    const old = [1, 2].map((n) => messageId(20 * DAY, n));
    pages = [old.map((id) => ({ id, pinned: false }))];
    const original = service['bot'].deleteMessage;
    service['bot'].deleteMessage = async (channel, id) => {
      if (id === old[0]) throw new Error('Unknown Message');
      return original.call(service['bot'], channel, id);
    };
    await run();
    assert.deepEqual(single, [old[1]]);
    assert.match(reports[0], /1 message deleted/);
  });

  it('tells the officer when the bot lacks access, and can be run again afterwards', async () => {
    listFails = true;
    await run();
    assert.match(reports[0], /Could not finish clearing.*Manage Messages/);
    listFails = false;
    assert.match((await run()).reply, /Clearing/);
  });

  it('refuses to clear a channel that is already being cleared', async () => {
    const first = await service.start(
      { serverId: SERVER, channelId: CHANNEL, invoker: invoker() },
      async () => undefined,
    );
    assert.equal((await run()).reply, CLEAR_MESSAGES.busy);
    await first.done;
  });
});
