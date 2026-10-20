import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { cleanChannel } from './channel-cleaner';

const DAY = 24 * 60 * 60 * 1000;
const CHANNEL = '333333333333333333';

/** A message id created `ageMs` ago; `n` keeps ids unique. */
const BASE = Date.now();
const messageId = (ageMs: number, n: number): string =>
  String(((BigInt(BASE - ageMs) - 1_420_070_400_000n) << 22n) + BigInt(n));

type Message = { id: string; pinned: boolean; bot: boolean };

describe('cleanChannel', () => {
  let pages: Message[][];
  let listCalls: (string | undefined)[];
  let bulk: string[][];
  let single: string[];
  const bot = {
    listMessages: async (_channel: string, before?: string) => {
      listCalls.push(before);
      return pages.shift() ?? [];
    },
    bulkDeleteMessages: async (_channel: string, ids: string[]) => void bulk.push(ids),
    deleteMessage: async (_channel: string, id: string) => void single.push(id),
  };
  const message = (n: number, extra: Partial<Message> = {}): Message => ({
    id: messageId(DAY, n),
    pinned: false,
    bot: false,
    ...extra,
  });

  beforeEach(() => {
    pages = [];
    listCalls = [];
    bulk = [];
    single = [];
    bot.bulkDeleteMessages = async (_channel, ids) => void bulk.push(ids);
  });

  it('deletes everything but pinned messages by default, bots included', async () => {
    pages = [[message(1), message(2, { bot: true }), message(3, { pinned: true })]];
    const result = await cleanChannel(bot, CHANNEL);
    assert.deepEqual(result, { deleted: 2, done: true });
    assert.deepEqual(bulk, [[messageId(DAY, 1), messageId(DAY, 2)]]);
  });

  it('keeps the messages of bots and webhooks when asked', async () => {
    pages = [[message(1), message(2, { bot: true }), message(3), message(4, { pinned: true })]];
    const result = await cleanChannel(bot, CHANNEL, { keepBotMessages: true });
    assert.equal(result.deleted, 2);
    assert.deepEqual(bulk, [[messageId(DAY, 1), messageId(DAY, 3)]]);
  });

  it('stops at the deadline with where to carry on, and carries on from there', async () => {
    pages = [
      [message(1), message(2)],
      [message(3), message(4)],
    ];
    let now = 1000;
    const clock = () => now;
    // The deadline passes while the first page is deleted.
    bot.bulkDeleteMessages = async (_channel, ids) => {
      bulk.push(ids);
      now = 5000;
    };
    const first = await cleanChannel(bot, CHANNEL, { deadline: 2000 }, clock);
    assert.deepEqual(first, { deleted: 2, done: false, cursor: messageId(DAY, 2) });

    const rest = await cleanChannel(bot, CHANNEL, { before: first.cursor, deadline: 9000 }, clock);
    assert.deepEqual(rest, { deleted: 2, done: true });
    assert.deepEqual(listCalls, [undefined, messageId(DAY, 2), messageId(DAY, 4)]);
  });
});
