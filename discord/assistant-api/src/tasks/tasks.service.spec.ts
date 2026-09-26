import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiscordAPIError } from '@discordjs/rest';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import type { TrackingService } from './tracking.service';
import { TasksService } from './tasks.service';

const CHANNEL = '333333333333333333';
const SERVER = '222222222222222222';
const unknownMessage = () =>
  new DiscordAPIError({ message: 'Unknown Message', code: 10008 }, 10008, 404, 'PATCH', 'u', {});

const validInput = {
  name: 'Raid announcement',
  runAtLocal: '2099-10-01T20:00',
  serverId: SERVER,
  channelId: CHANNEL,
  content: 'Raid tonight',
  seedReactions: ['👍'],
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
  let listArgs: any;
  let listResult: any[] | null;
  let rawQueries: any[];
  let rawIds: { id: string }[];
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
    listArgs = null;
    listResult = null;
    rawQueries = [];
    rawIds = [];
    // A post that already went out: its message is live in Discord.
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
        postedAt: PAST.toISOString(),
      },
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
    const tracking = {
      resolveSources: async (_guild: string, tokens: unknown[]) => {
        trackingCalls.push(['resolve', tokens.length]);
        if (badSource) throw new BadRequestException('There is no post with that id');
        return new Map();
      },
      fetchPeople: async () => people,
      syncTracking: async (_id: string, tokens: unknown[]) => {
        trackingCalls.push(['sync', tokens.length]);
      },
      locationOfTask: () => ({ channelId: 'c', messageId: 'm' }),
      readReactors: async () => [{ id: '1', name: 'Ana' }],
    } as unknown as TrackingService;
    service = new TasksService(prisma, bot, tracking);
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

    it('searches every page by name and text, all words required, and returns the match total', async () => {
      rawIds = [{ id: 't1' }];
      const page = await service.list('g', { query: 'raid TONIGHT', page: 2 });
      const [listQuery] = rawQueries;
      assert.match(listQuery.sql, /name ILIKE .* OR config->>'content' ILIKE .* AND .*ILIKE/s);
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

  it('returns a single post for its edit page', async () => {
    const dto = await service.get('t1');
    assert.equal(dto.id, 't1');
    assert.equal(dto.post.content, 'Raid tonight');
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

    it('shows link previews unless told otherwise', async () => {
      const dto = await service.create('g', 'u', validInput);
      assert.equal(created.config.embedLinks, true);
      assert.equal(dto.post.embedLinks, true);
      const hidden = await service.create('g', 'u', { ...validInput, embedLinks: false });
      assert.equal(created.config.embedLinks, false);
      assert.equal(hidden.post.embedLinks, false);
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
  });

  describe('dynamic reactions in the text', () => {
    const withTag = `Going: {{reactions post="Raid signup" emoji=👍 show=names}}`;

    it('keeps tracking rows in line with the text when a post is created', async () => {
      await service.create('g', 'u', { ...validInput, content: withTag });
      assert.deepEqual(trackingCalls, [
        ['resolve', 1],
        ['resolve', 1],
        ['sync', 1],
      ]);
    });

    it('refuses a post that reads the reactions of an unknown post', async () => {
      badSource = true;
      await assert.rejects(
        service.create('g', 'u', { ...validInput, content: withTag }),
        /no post with that id/,
      );
      assert.equal(created, null);
    });

    it('rejects a tag that is written wrongly', async () => {
      await assert.rejects(
        service.create('g', 'u', { ...validInput, content: 'Going: {{reactions post=A}}' }),
        /needs an emoji/,
      );
    });

    it('edits a live post with the people filled in, quietly, and syncs the rows', async () => {
      people = new Map([[`name:raid signup|👍|names`, [{ id: '1', name: 'Ana' }]]]);
      await service.update('t1', { content: withTag });
      assert.deepEqual(edits, [
        [CHANNEL, 'm1', 'Going: Ana', { suppressEmbeds: false, quiet: true }],
      ]);
      assert.equal(updated.config.content, withTag);
      assert.equal(updated.state.renderedContent, 'Going: Ana');
      assert.deepEqual(trackingCalls.at(-1), ['sync', 1]);
    });

    it('removes the tracking when the tags are taken out of the text', async () => {
      await service.update('t1', { content: 'No more tags' });
      assert.deepEqual(trackingCalls.at(-1), ['sync', 0]);
    });

    it('lists who reacted with an emoji', async () => {
      assert.deepEqual(await service.reactionUsers('t1', '👍'), [{ id: '1', name: 'Ana' }]);
      await assert.rejects(service.reactionUsers('t1', 'abc'), BadRequestException);
      await assert.rejects(service.reactionUsers('t1', undefined), BadRequestException);
    });
  });

  describe('a post that is live in Discord', () => {
    it('edits the Discord message when the text changes (live edit)', async () => {
      await service.update('t1', { content: 'Raid moved to 21:00' });
      assert.deepEqual(edits, [[CHANNEL, 'm1', 'Raid moved to 21:00', { suppressEmbeds: false }]]);
      assert.equal(updated.config.content, 'Raid moved to 21:00');
    });

    it('edits the message when only the link previews are switched off or on', async () => {
      await service.update('t1', { embedLinks: false });
      assert.deepEqual(edits, [[CHANNEL, 'm1', 'Raid tonight', { suppressEmbeds: true }]]);
      assert.equal(updated.config.embedLinks, false);
    });

    it('rejects link preview values that are not true or false', async () => {
      await assert.rejects(service.update('t1', { embedLinks: 'no' }), /true or false/);
    });

    it('does not touch Discord when the text is unchanged', async () => {
      await service.update('t1', { name: 'Renamed', content: 'Raid tonight' });
      assert.deepEqual(edits, []);
      assert.equal(updated.name, 'Renamed');
    });

    it('still saves when the message was deleted in Discord meanwhile, and marks it', async () => {
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

    it('cannot be posted again or moved to a new date: it is one message', async () => {
      await assert.rejects(service.update('t1', { postNow: true }), /already in Discord/);
      await assert.rejects(
        service.update('t1', { runAtLocal: FUTURE_LOCAL }),
        /already in Discord/,
      );
      await assert.rejects(service.runNow('t1'), /already in Discord/);
      assert.equal(updated, null);
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
      await service.update('t1', { content: 'x' });
      assert.equal('nextRunAt' in updated, false);
      assert.deepEqual(edits, []);
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

  describe('delete post (removes the message, keeps the post)', () => {
    it('deletes the Discord message and marks the post as deleted', async () => {
      await service.deletePost('t1');
      assert.deepEqual(deletedMessages, [[CHANNEL, 'm1']]);
      assert.equal(updated.state.messageDeleted, true);
      assert.equal(updated.state.messageId, 'm1');
      assert.equal(removed, false);
    });

    it('leaves the schedule alone', async () => {
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

  describe('a post whose message was deleted', () => {
    beforeEach(() => {
      task.state = { messageId: 'm1', channelId: CHANNEL, serverId: SERVER, messageDeleted: true };
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
      await service.update('t1', { content: 'Rewritten' });
      assert.deepEqual(edits, []);
      assert.equal(updated.config.content, 'Rewritten');
    });
  });

  describe('post now', () => {
    it('makes a post that has not gone out due immediately', async () => {
      task.state = {};
      await service.runNow('t1');
      assert.ok(updated.nextRunAt <= new Date());
    });

    it('refuses a paused post', async () => {
      task.state = {};
      task.enabled = false;
      await assert.rejects(service.runNow('t1'), /Resume the post first/);
    });
  });

  describe('untrack (removes the post, keeps the message)', () => {
    it('removes the row without touching the Discord message', async () => {
      await service.remove('t1');
      assert.equal(removed, true);
      assert.deepEqual(deletedMessages, []);
    });
  });

  describe('reactions', () => {
    it('returns the live counts of the current post', async () => {
      assert.deepEqual(await service.reactions('t1'), [
        { emoji: '👍', emojiId: null, count: 3, imageUrl: null },
      ]);
    });

    it('returns nothing before the post went out or after it was deleted', async () => {
      task.state = {};
      assert.deepEqual(await service.reactions('t1'), []);
      task.state = { messageId: 'm1', channelId: CHANNEL, messageDeleted: true };
      assert.deepEqual(await service.reactions('t1'), []);
    });
  });

  it('404s for unknown posts', async () => {
    task = null;
    await assert.rejects(service.remove('nope'), NotFoundException);
  });
});
