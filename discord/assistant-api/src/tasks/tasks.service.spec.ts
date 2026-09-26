import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiscordAPIError } from '@discordjs/rest';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import type { PostImagesService } from './post-images.service';
import type { TrackingService } from './tracking.service';
import { TasksService } from './tasks.service';

const CHANNEL = '333333333333333333';
const SERVER = '222222222222222222';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const IMG = '99999999-9999-4999-8999-999999999999';
const unknownMessage = () =>
  new DiscordAPIError({ message: 'Unknown Message', code: 10008 }, 10008, 404, 'PATCH', 'u', {});

/** A message of a post, as the backoffice sends it. */
const input = (content: string, over: Record<string, unknown> = {}) => ({ content, ...over });
/** A part as saved. */
const part = (id: string, content = 'Raid tonight', over: Record<string, unknown> = {}) => ({
  id,
  content,
  seedReactions: ['👍'],
  embedLinks: true,
  delaySeconds: 0,
  imageIds: [] as string[],
  ...over,
});
/** A part as it is in Discord. */
const posted = (partId: string, messageId: string, over: Record<string, unknown> = {}) => ({
  partId,
  messageId,
  channelId: CHANNEL,
  serverId: SERVER,
  postedAt: '2020-01-01T18:00:00.000Z',
  renderedContent: 'Raid tonight',
  imageIds: [] as string[],
  embedLinks: true,
  ...over,
});

const validInput = {
  name: 'Raid announcement',
  runAtLocal: '2099-10-01T20:00',
  serverId: SERVER,
  channelId: CHANNEL,
  parts: [input('Raid tonight', { seedReactions: ['👍'] })],
};

const PAST = new Date('2020-01-01T18:00:00Z');
const FUTURE_LOCAL = '2099-11-05T21:00';
const FUTURE_UTC = '2099-11-05T20:00:00.000Z'; // Paris is UTC+1 in November

describe('TasksService', () => {
  let task: any;
  let created: any;
  let updated: any;
  let serverInGuild: boolean;
  let channelsInServer: { id: string; name: string }[];
  let edits: any[];
  let editError: Error | null;
  let trackingCalls: unknown[][];
  let badSource: boolean;
  let people: Map<string, { id: string; name: string }[]>;
  let deletedMessages: unknown[][];
  let deleteError: Error | null;
  let removed: boolean;
  let reactionsResult: any[];
  let reactionsFor: string[];
  let listArgs: any;
  let listResult: any[] | null;
  let rawQueries: any[];
  let rawIds: { id: string }[];
  let rosterEntries: unknown[];
  let imageChecks: unknown[][];
  let attached: unknown[][];
  let service: TasksService;

  beforeEach(() => {
    serverInGuild = true;
    channelsInServer = [{ id: CHANNEL, name: 'announcements' }];
    created = null;
    updated = null;
    edits = [];
    trackingCalls = [];
    badSource = false;
    people = new Map();
    editError = null;
    deletedMessages = [];
    deleteError = null;
    removed = false;
    reactionsResult = [{ emoji: '👍', emojiId: null, count: 3 }];
    reactionsFor = [];
    listArgs = null;
    listResult = null;
    rawQueries = [];
    rawIds = [];
    imageChecks = [];
    rosterEntries = [];
    attached = [];
    // A post that already went out: its one message is live in Discord.
    task = {
      id: 't1',
      guildId: 'g',
      name: 'Raid announcement',
      type: 'POST',
      enabled: true,
      scheduleKind: 'ONCE',
      runAt: PAST,
      timeOfDay: null,
      weekday: null,
      nextRunAt: null,
      lastRunAt: PAST,
      lastStatus: 'SUCCESS',
      lastError: null,
      config: { serverId: SERVER, channelId: CHANNEL, parts: [part(P1)] },
      state: { messages: [posted(P1, 'm1')] },
      createdAt: new Date(),
    };
    const prisma = {
      guild: { findUnique: async () => ({ region: 'EU' }) },
      $queryRaw: async (sql: any) => {
        rawQueries.push(sql);
        return sql.sql.includes('count(') ? [{ total: 14 }] : rawIds;
      },
      discordServer: { findFirst: async () => (serverInGuild ? { id: 'row' } : null) },
      scheduledTask: {
        findUnique: async () => task,
        findMany: async (args: any) => {
          listArgs = args;
          return listResult ?? [task];
        },
        count: async () => 23,
        create: async (args: any) => {
          created = args.data;
          return { ...task, ...args.data, id: 'new', state: {} };
        },
        update: async (args: any) => {
          updated = { ...(updated ?? {}), ...args.data };
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
      getReactions: async (_channel: string, messageId: string) => {
        reactionsFor.push(messageId);
        return reactionsResult;
      },
      deleteMessage: async (...args: unknown[]) => {
        if (deleteError) throw deleteError;
        deletedMessages.push(args);
      },
    } as unknown as DiscordBotService;
    const tracking = {
      resolveSources: async (_guild: string, tokens: unknown[]) => {
        trackingCalls.push(['resolve', tokens.length]);
        if (badSource) throw new BadRequestException('There is no post with that id');
        return new Map();
      },
      fetchPeople: async () => people,
      rosterOf: async (_guild: string, content: string) =>
        content.includes('{{roster')
          ? { tokens: [{ raw: content, expression: 'roster.length' }], entries: rosterEntries }
          : undefined,
      syncTracking: async (_id: string, tokens: unknown[]) => {
        trackingCalls.push(['sync', tokens.length]);
      },
      locationOfTask: (_task: unknown, partNumber: number) => ({
        channelId: 'c',
        messageId: `m${partNumber}`,
      }),
      readReactors: async () => [{ id: '1', name: 'Ana' }],
    } as unknown as TrackingService;
    const images = {
      assertUsable: async (...args: unknown[]) => void imageChecks.push(args),
      attach: async (...args: unknown[]) => void attached.push(args),
      files: async (ids: string[]) =>
        ids.map((id) => ({ name: `${id}.png`, data: Buffer.alloc(1), contentType: 'image/png' })),
    } as unknown as PostImagesService;
    service = new TasksService(prisma, bot, tracking, images);
  });

  describe('listing (ten to a page, searchable)', () => {
    it('lists the newest date first, ten at a time, with the total', async () => {
      const page = await service.list('g', { page: '3' });
      assert.deepEqual(listArgs.orderBy, [{ runAt: 'desc' }, { id: 'asc' }]);
      assert.equal(listArgs.skip, 20);
      assert.equal(listArgs.take, 10);
      assert.deepEqual([page.total, page.page, page.pageSize, page.items.length], [23, 3, 10, 1]);
    });

    it('starts at the first page for a missing or bad page', async () => {
      await service.list('g', { page: 'abc' });
      assert.equal(listArgs.skip, 0);
    });

    it('searches every page by name and by the text of any message, all words required', async () => {
      rawIds = [{ id: 't1' }];
      const page = await service.list('g', { query: 'raid TONIGHT', page: 2 });
      const [listQuery] = rawQueries;
      assert.match(
        listQuery.sql,
        /name ILIKE .* OR EXISTS .*jsonb_array_elements\(config->'parts'\).*part->>'content' ILIKE .* AND .*ILIKE/s,
      );
      assert.match(listQuery.sql, /LIMIT 10 OFFSET 10/);
      assert.ok(listQuery.values.includes('%raid%') && listQuery.values.includes('%TONIGHT%'));
      assert.equal(page.total, 14);
      assert.deepEqual(
        page.items.map((item) => item.id),
        ['t1'],
      );
    });

    it('keeps the order the search returned', async () => {
      const other = { ...task, id: 't2' };
      rawIds = [{ id: 't2' }, { id: 't1' }];
      listResult = [task, other];
      const page = await service.list('g', { query: 'raid' });
      assert.deepEqual(
        page.items.map((item) => item.id),
        ['t2', 't1'],
      );
    });

    it('does not use the search query without search words', async () => {
      await service.list('g', { query: '   ' });
      assert.deepEqual(rawQueries, []);
    });
  });

  it('returns a single post for its edit page, with each message and where it is in Discord', async () => {
    const dto = await service.get('t1');
    assert.equal(dto.id, 't1');
    assert.equal(dto.post.parts[0].content, 'Raid tonight');
    assert.equal(
      dto.post.parts[0].posted?.url,
      `https://discord.com/channels/${SERVER}/${CHANNEL}/m1`,
    );
    assert.deepEqual([dto.post.live, dto.post.complete, dto.post.wasDeleted], [true, true, false]);
    await assert.rejects(async () => {
      task = null;
      await service.get('nope');
    }, NotFoundException);
  });

  describe('create', () => {
    it('schedules a one-time post at the chosen time in the guild timezone (Paris, UTC+2 in October)', async () => {
      const dto = await service.create('g', 'u', { ...validInput, runAtLocal: '2099-10-01T20:00' });
      assert.equal(created.scheduleKind, 'ONCE');
      assert.equal(created.runAt.toISOString(), '2099-10-01T18:00:00.000Z');
      assert.equal(created.nextRunAt.toISOString(), '2099-10-01T18:00:00.000Z');
      assert.equal(created.createdById, 'u');
      assert.equal(dto.schedule.description, 'Once on 2099-10-01 at 20:00');
      assert.equal(dto.timezone, 'Europe/Paris');
    });

    it('stores the messages with ids and defaults: link previews on, no wait, no images', async () => {
      await service.create('g', 'u', validInput);
      const [saved] = created.config.parts;
      assert.match(saved.id, /^[0-9a-f-]{36}$/);
      assert.deepEqual(
        [saved.content, saved.seedReactions, saved.embedLinks, saved.delaySeconds, saved.imageIds],
        ['Raid tonight', ['👍'], true, 0, []],
      );
    });

    it('keeps every message in order, each with its own settings', async () => {
      await service.create('g', 'u', {
        ...validInput,
        parts: [
          input('First'),
          input('Second', { embedLinks: false, delaySeconds: 10, seedReactions: ['✅'] }),
          input('Third', { imageIds: [IMG] }),
        ],
      });
      const parts = created.config.parts;
      assert.deepEqual(
        parts.map((p: any) => [
          p.content,
          p.embedLinks,
          p.delaySeconds,
          p.seedReactions,
          p.imageIds,
        ]),
        [
          ['First', true, 0, [], []],
          ['Second', false, 10, ['✅'], []],
          ['Third', true, 0, [], [IMG]],
        ],
      );
      assert.equal(new Set(parts.map((p: any) => p.id)).size, 3);
    });

    it('ignores a wait on the first message', async () => {
      await service.create('g', 'u', {
        ...validInput,
        parts: [input('First', { delaySeconds: 30 })],
      });
      assert.equal(created.config.parts[0].delaySeconds, 0);
    });

    it('limits the messages, the waits and the images', async () => {
      const many = Array.from({ length: 11 }, (_, i) => input(`m${i}`));
      await assert.rejects(
        service.create('g', 'u', { ...validInput, parts: many }),
        /at most 10 messages/,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, parts: [] }),
        /at least one message/,
      );
      await assert.rejects(
        service.create('g', 'u', {
          ...validInput,
          parts: [input('a'), input('b', { delaySeconds: 61 })],
        }),
        /whole number of seconds/,
      );
      const slow = Array.from({ length: 6 }, (_, i) =>
        input(`m${i}`, { delaySeconds: i === 0 ? 0 : 60 }),
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, parts: slow }),
        /add up to 300 seconds/,
      );
      await assert.rejects(
        service.create('g', 'u', {
          ...validInput,
          parts: [input('a', { imageIds: Array(5).fill(IMG) })],
        }),
        /at most 4 images/,
      );
    });

    it('checks the images belong to the guild, then makes them the post’s', async () => {
      await service.create('g', 'u', { ...validInput, parts: [input('a', { imageIds: [IMG] })] });
      assert.deepEqual(imageChecks, [['g', undefined, [IMG]]]);
      assert.equal(attached.length, 1);
      assert.equal(attached[0][0], 'new');
    });

    it('can post right away, without a date', async () => {
      await service.create('g', 'u', { ...validInput, runAtLocal: undefined, postNow: true });
      assert.ok(created.nextRunAt <= new Date());
      assert.equal(created.enabled, true);
    });

    it('does not schedule a paused post', async () => {
      await service.create('g', 'u', { ...validInput, enabled: false });
      assert.equal(created.nextRunAt, null);
    });

    it('needs a date in the future', async () => {
      await assert.rejects(
        service.create('g', 'u', { ...validInput, runAtLocal: '2020-01-01T20:00' }),
        /future/,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, runAtLocal: undefined }),
        /Pick the date/,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, runAtLocal: 'soon' }),
        BadRequestException,
      );
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

    it('rejects a missing name or an empty message', async () => {
      await assert.rejects(
        service.create('g', 'u', { ...validInput, name: ' ' }),
        BadRequestException,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, parts: [input('')] }),
        BadRequestException,
      );
    });
  });

  describe('dynamic reactions in the text', () => {
    const withTag = `Going: {{reactions sourcePost="Raid signup" emoji=👍 show="reactions.map(r => r.name)"}}`;

    it('keeps tracking rows in line with the text of every message when a post is created', async () => {
      await service.create('g', 'u', { ...validInput, parts: [input(withTag), input(withTag)] });
      assert.deepEqual(trackingCalls, [
        ['resolve', 2],
        ['resolve', 2],
        ['sync', 2],
      ]);
    });

    it('refuses a post that reads the reactions of an unknown post', async () => {
      badSource = true;
      await assert.rejects(
        service.create('g', 'u', { ...validInput, parts: [input(withTag)] }),
        /no post with that id/,
      );
      assert.equal(created, null);
    });

    it('rejects a tag that is written wrongly, saying nothing is saved', async () => {
      await assert.rejects(
        service.create('g', 'u', {
          ...validInput,
          parts: [input('Going: {{reactions sourcePost=A}}')],
        }),
        /needs an emoji/,
      );
    });

    it('edits a live message with the people filled in, quietly, and syncs the rows', async () => {
      people = new Map([[`name:raid signup#1|👍`, [{ id: '1', name: 'Ana' }]]]);
      await service.update('t1', { parts: [input(withTag, { id: P1 })] });
      assert.deepEqual(edits, [
        [CHANNEL, 'm1', 'Going: Ana', { suppressEmbeds: false, quiet: true }],
      ]);
      assert.equal(updated.config.parts[0].content, withTag);
      assert.equal(updated.state.messages[0].renderedContent, 'Going: Ana');
      assert.deepEqual(trackingCalls.at(-1), ['sync', 1]);
    });

    it('removes the tracking when the tags are taken out of the text', async () => {
      await service.update('t1', { parts: [input('No more tags', { id: P1 })] });
      assert.deepEqual(trackingCalls.at(-1), ['sync', 0]);
    });

    it('lists who reacted with an emoji, for a chosen message', async () => {
      assert.deepEqual(await service.reactionUsers('t1', '👍', 2), [{ id: '1', name: 'Ana' }]);
      await assert.rejects(service.reactionUsers('t1', 'abc'), BadRequestException);
      await assert.rejects(service.reactionUsers('t1', undefined), BadRequestException);
    });
  });

  describe('a post that is live in Discord', () => {
    it('edits the Discord message when the text changes (live edit)', async () => {
      await service.update('t1', { parts: [input('Raid moved to 21:00', { id: P1 })] });
      assert.deepEqual(edits, [[CHANNEL, 'm1', 'Raid moved to 21:00', { suppressEmbeds: false }]]);
      assert.equal(updated.config.parts[0].content, 'Raid moved to 21:00');
    });

    it('edits the message when only the link previews are switched off or on', async () => {
      await service.update('t1', { parts: [input('Raid tonight', { id: P1, embedLinks: false })] });
      assert.deepEqual(edits, [[CHANNEL, 'm1', 'Raid tonight', { suppressEmbeds: true }]]);
      assert.equal(updated.config.parts[0].embedLinks, false);
    });

    it('rejects link preview values that are not true or false', async () => {
      await assert.rejects(
        service.update('t1', { parts: [input('x', { id: P1, embedLinks: 'no' })] }),
        /true or false/,
      );
    });

    it('replaces the images of the message when they change, and only then', async () => {
      await service.update('t1', { parts: [input('Raid tonight', { id: P1, imageIds: [IMG] })] });
      assert.equal(edits.length, 1);
      assert.deepEqual(
        edits[0][3].files.map((f: any) => f.name),
        [`${IMG}.png`],
      );
      assert.deepEqual(updated.state.messages[0].imageIds, [IMG]);
      assert.equal(attached.at(-1)?.[0], 't1');
    });

    it('removes every image from the message when the last one is taken out', async () => {
      task.state = { messages: [posted(P1, 'm1', { imageIds: [IMG] })] };
      task.config.parts[0].imageIds = [IMG];
      await service.update('t1', { parts: [input('Raid tonight', { id: P1, imageIds: [] })] });
      assert.deepEqual(edits[0][3].files, []);
    });

    it('does not touch Discord when nothing about the message changed', async () => {
      await service.update('t1', { name: 'Renamed', parts: [input('Raid tonight', { id: P1 })] });
      assert.deepEqual(edits, []);
      assert.equal(updated.name, 'Renamed');
    });

    it('still saves when the message was deleted in Discord meanwhile, and marks it', async () => {
      editError = unknownMessage();
      await service.update('t1', { parts: [input('New text', { id: P1 })] });
      assert.equal(updated.state.messages[0].deleted, true);
      assert.equal(updated.config.parts[0].content, 'New text');
    });

    it('saves nothing when Discord refuses for another reason', async () => {
      editError = new Error('Missing Permissions');
      await assert.rejects(
        service.update('t1', { parts: [input('New text', { id: P1 })] }),
        /Could not update the post in Discord/,
      );
      assert.equal(updated?.config, undefined);
    });

    it('cannot be posted again or moved to a new date: it is in Discord', async () => {
      await assert.rejects(service.update('t1', { postNow: true }), /already in Discord/);
      await assert.rejects(
        service.update('t1', { runAtLocal: FUTURE_LOCAL }),
        /already in Discord/,
      );
      await assert.rejects(service.runNow('t1'), /already in Discord/);
      assert.equal(updated, null);
    });

    it('cannot move to another channel while it is in Discord', async () => {
      channelsInServer = [
        { id: CHANNEL, name: 'announcements' },
        { id: '444444444444444444', name: 'other' },
      ];
      await assert.rejects(
        service.update('t1', { channelId: '444444444444444444' }),
        /delete it first to move it/,
      );
    });

    it('accepts the form sending its unchanged (past) date back', async () => {
      await service.update('t1', { runAtLocal: '2020-01-01T19:00', name: 'Renamed' });
      assert.equal(updated.name, 'Renamed');
      assert.equal('nextRunAt' in updated, false);
    });

    it('stays unscheduled when resumed after being paused', async () => {
      task.enabled = false;
      await service.update('t1', { enabled: true });
      assert.equal(updated.nextRunAt, null);
    });
  });

  describe('a sequence of messages that is live in Discord', () => {
    beforeEach(() => {
      task.config.parts = [part(P1, 'One'), part(P2, 'Two')];
      task.state = {
        messages: [
          posted(P1, 'm1', { renderedContent: 'One' }),
          posted(P2, 'm2', { renderedContent: 'Two' }),
        ],
      };
    });

    it('edits only the message that changed', async () => {
      await service.update('t1', {
        parts: [input('One', { id: P1 }), input('Two, edited', { id: P2 })],
      });
      assert.deepEqual(
        edits.map((e) => [e[1], e[2]]),
        [['m2', 'Two, edited']],
      );
    });

    it('keeps the order of the messages that are in Discord', async () => {
      await assert.rejects(
        service.update('t1', { parts: [input('Two', { id: P2 }), input('One', { id: P1 })] }),
        /keep their order/,
      );
      assert.equal(edits.length, 0);
    });

    it('does not let a message be added to a post that is in Discord', async () => {
      await assert.rejects(
        service.update('t1', {
          parts: [input('One', { id: P1 }), input('Two', { id: P2 }), input('Three')],
        }),
        /cannot be added to a post that is already in Discord/,
      );
      await assert.rejects(
        service.update('t1', {
          parts: [input('New'), input('One', { id: P1 }), input('Two', { id: P2 })],
        }),
        /cannot be added/,
      );
      assert.equal(updated, null);
      assert.deepEqual(edits, []);
    });

    it('deletes the Discord message of a message taken out of the post', async () => {
      await service.update('t1', { parts: [input('Two', { id: P2 })] });
      assert.deepEqual(deletedMessages, [[CHANNEL, 'm1']]);
      assert.deepEqual(
        updated.state.messages.map((m: any) => m.partId),
        [P2],
      );
      assert.deepEqual(
        updated.config.parts.map((p: any) => p.id),
        [P2],
      );
    });

    it('keeps the post if the Discord message to delete is already gone', async () => {
      deleteError = unknownMessage();
      await service.update('t1', { parts: [input('Two', { id: P2 })] });
      assert.deepEqual(
        updated.state.messages.map((m: any) => m.partId),
        [P2],
      );
    });

    it('leaves the post as it was when Discord will not delete the message', async () => {
      deleteError = new Error('Missing Permissions');
      await assert.rejects(
        service.update('t1', { parts: [input('Two', { id: P2 })] }),
        /Could not delete the message in Discord/,
      );
      assert.equal(updated?.config, undefined);
    });

    it('does not let a message be added to a post that stopped halfway either', async () => {
      task.state = { messages: [posted(P1, 'm1', { renderedContent: 'One' })] };
      await assert.rejects(
        service.update('t1', {
          parts: [input('One', { id: P1 }), input('Two', { id: P2 }), input('Three')],
        }),
        /cannot be added/,
      );
    });

    it('lets the messages that are not in Discord yet be changed and moved freely', async () => {
      task.state = { messages: [posted(P1, 'm1', { renderedContent: 'One' })] };
      task.config.parts = [part(P1, 'One'), part(P2, 'Two'), part(P3, 'Three')];
      await service.update('t1', {
        parts: [input('One', { id: P1 }), input('Three', { id: P3 }), input('Two', { id: P2 })],
      });
      assert.deepEqual(
        updated.config.parts.map((p: any) => p.id),
        [P1, P3, P2],
      );
    });
  });

  describe('a post that has not gone out yet', () => {
    beforeEach(() => {
      task.state = {};
      task.lastRunAt = null;
      task.lastStatus = null;
      task.runAt = new Date('2099-10-01T18:00:00Z');
      task.nextRunAt = task.runAt;
    });

    it('moves to a new date', async () => {
      await service.update('t1', { runAtLocal: FUTURE_LOCAL });
      assert.equal(updated.runAt.toISOString(), FUTURE_UTC);
      assert.equal(updated.nextRunAt.toISOString(), FUTURE_UTC);
    });

    it('rejects a new date in the past', async () => {
      await assert.rejects(service.update('t1', { runAtLocal: '2021-01-01T20:00' }), /future/);
    });

    it('can be posted right away', async () => {
      await service.update('t1', { postNow: true });
      assert.ok(updated.nextRunAt <= new Date());
    });

    it('keeps its schedule when only the text changes, and does not touch Discord', async () => {
      await service.update('t1', { parts: [input('x', { id: P1 })] });
      assert.equal('nextRunAt' in updated, false);
      assert.deepEqual(edits, []);
    });

    it('can become a sequence, in any order, and can move channel', async () => {
      await service.update('t1', {
        channelId: CHANNEL,
        parts: [input('B'), input('A', { id: P1 })],
      });
      assert.equal(updated.config.parts.length, 2);
      assert.equal(updated.config.parts[1].id, P1);
    });

    it('is unscheduled when paused, and goes out on resume even if its time passed (late rather than never)', async () => {
      await service.update('t1', { enabled: false });
      assert.equal(updated.nextRunAt, null);
      task.enabled = false;
      task.runAt = new Date('2020-01-01T18:00:00Z');
      task.nextRunAt = null;
      await service.update('t1', { enabled: true });
      assert.ok(updated.nextRunAt <= new Date());
    });
  });

  describe('delete post (removes the messages, keeps the post)', () => {
    it('deletes the Discord message and marks it as deleted', async () => {
      await service.deletePost('t1');
      assert.deepEqual(deletedMessages, [[CHANNEL, 'm1']]);
      assert.equal(updated.state.messages[0].deleted, true);
      assert.equal(updated.state.messages[0].messageId, 'm1');
      assert.equal(removed, false);
    });

    it('deletes every message of a sequence, in one go', async () => {
      task.config.parts = [part(P1), part(P2)];
      task.state = { messages: [posted(P1, 'm1'), posted(P2, 'm2')] };
      await service.deletePost('t1');
      assert.deepEqual(deletedMessages, [
        [CHANNEL, 'm1'],
        [CHANNEL, 'm2'],
      ]);
      assert.deepEqual(
        updated.state.messages.map((m: any) => m.deleted),
        [true, true],
      );
    });

    it('leaves the schedule alone', async () => {
      await service.deletePost('t1');
      assert.equal('nextRunAt' in updated, false);
      assert.equal('enabled' in updated, false);
    });

    it('treats a message that is already gone as deleted', async () => {
      deleteError = unknownMessage();
      await service.deletePost('t1');
      assert.equal(updated.state.messages[0].deleted, true);
    });

    it('keeps what it deleted and reports it when Discord refuses', async () => {
      deleteError = new Error('Missing Permissions');
      await assert.rejects(service.deletePost('t1'), /Could not delete the post in Discord/);
      assert.equal(updated.state.messages[0].deleted, undefined);
    });

    it('refuses when there is no post in Discord', async () => {
      task.state = {};
      await assert.rejects(service.deletePost('t1'), /no post in Discord/);
      task.state = { messages: [posted(P1, 'm1', { deleted: true })] };
      await assert.rejects(service.deletePost('t1'), /no post in Discord/);
      assert.deepEqual(deletedMessages, []);
    });
  });

  describe('a post whose messages were deleted', () => {
    beforeEach(() => {
      task.state = { messages: [posted(P1, 'm1', { deleted: true })] };
    });

    it('can be scheduled again for a new date', async () => {
      await service.update('t1', { runAtLocal: FUTURE_LOCAL });
      assert.equal(updated.nextRunAt.toISOString(), FUTURE_UTC);
    });

    it('can be posted again right away', async () => {
      await service.update('t1', { postNow: true });
      assert.ok(updated.nextRunAt <= new Date());
      await service.runNow('t1');
      assert.ok(updated.nextRunAt <= new Date());
    });

    it('is not posted again on its own when resumed with a date in the past', async () => {
      task.enabled = false;
      await service.update('t1', { enabled: true });
      assert.equal(updated.nextRunAt, null);
    });

    it('lets its text be edited without touching Discord', async () => {
      await service.update('t1', { parts: [input('Rewritten', { id: P1 })] });
      assert.deepEqual(edits, []);
      assert.equal(updated.config.parts[0].content, 'Rewritten');
    });
  });

  describe('post now', () => {
    it('makes a post that has not gone out due immediately', async () => {
      task.state = {};
      await service.runNow('t1');
      assert.ok(updated.nextRunAt <= new Date());
    });

    it('finishes a post that stopped halfway', async () => {
      task.config.parts = [part(P1), part(P2)];
      task.state = { messages: [posted(P1, 'm1')] };
      await service.runNow('t1');
      assert.ok(updated.nextRunAt <= new Date());
    });

    it('refuses a paused post', async () => {
      task.state = {};
      task.enabled = false;
      await assert.rejects(service.runNow('t1'), /Resume the post first/);
    });
  });

  describe('untrack (removes the post, keeps the messages)', () => {
    it('removes the row without touching the Discord messages', async () => {
      await service.remove('t1');
      assert.equal(removed, true);
      assert.deepEqual(deletedMessages, []);
    });
  });

  describe('reactions', () => {
    it('returns the live counts of the first message by default', async () => {
      assert.deepEqual(await service.reactions('t1'), [
        { emoji: '👍', emojiId: null, count: 3, imageUrl: null },
      ]);
    });

    it('returns the counts of the message asked for', async () => {
      task.config.parts = [part(P1), part(P2)];
      task.state = { messages: [posted(P1, 'm1'), posted(P2, 'm2')] };
      await service.reactions('t1', 2);
      assert.deepEqual(reactionsFor, ['m2']);
      assert.deepEqual(await service.reactions('t1', 3), []);
    });

    it('returns nothing before the post went out or after it was deleted', async () => {
      task.state = {};
      assert.deepEqual(await service.reactions('t1'), []);
      task.state = { messages: [posted(P1, 'm1', { deleted: true })] };
      assert.deepEqual(await service.reactions('t1'), []);
    });

    it('marks a message deleted in Discord when it is gone', async () => {
      reactionsResult = [];
      const original = service['bot'].getReactions;
      service['bot'].getReactions = async () => {
        throw unknownMessage();
      };
      assert.deepEqual(await service.reactions('t1'), []);
      assert.equal(updated.state.messages[0].deleted, true);
      service['bot'].getReactions = original;
    });
  });

  it('404s for unknown posts', async () => {
    task = null;
    await assert.rejects(service.remove('nope'), NotFoundException);
  });
});
