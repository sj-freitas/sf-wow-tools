import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DiscordAPIError } from '@discordjs/rest';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { hashReactors, parseDynamicTokens } from './dynamic-content';
import { TrackingService } from './tracking.service';

const POST = '11111111-2222-3333-4444-555555555555';
const BOT = 'bot-1';
const ana = { id: '1', name: 'Ana' };
const bruno = { id: '2', name: 'Bruno' };

const liveState = { messageId: 'm1', channelId: 'c1', renderedContent: undefined as unknown };
const post = (over: Record<string, unknown> = {}): any => ({
  id: POST,
  guildId: 'g1',
  name: 'Raid signup',
  config: { content: `Going: {{reactions post="${POST}" emoji=👍 show=names}}`, embedLinks: true },
  state: { ...liveState },
  ...over,
});

describe('TrackingService', () => {
  let tasks: Record<string, any>;
  let rows: any[];
  let reactors: Record<string, { id: string; name: string }[]>;
  let readFails: Error | null;
  let edits: any[][];
  let created: any[];
  let deletedRows: string[];
  let taskUpdates: any[];
  let mains: Record<string, { firstName: string; lastName: string }[]>;
  let service: TrackingService;

  beforeEach(() => {
    tasks = { [POST]: post() };
    rows = [];
    reactors = { '👍': [ana, bruno, { id: BOT, name: 'Guild Assistant' }] };
    readFails = null;
    edits = [];
    created = [];
    deletedRows = [];
    taskUpdates = [];
    mains = {};
    const prisma = {
      scheduledTask: {
        findMany: async (args: any) =>
          Object.values(tasks).filter(
            (t: any) =>
              t.guildId === args.where.guildId &&
              t.name.toLowerCase() === args.where.name.equals.toLowerCase(),
          ),
        findFirst: async (args: any) =>
          Object.values(tasks).find(
            (t: any) => t.id === args.where.id && t.guildId === args.where.guildId,
          ) ?? null,
        findUnique: async (args: any) => tasks[args.where.id] ?? null,
        update: async (args: any) => void taskUpdates.push(args.data),
      },
      player: {
        findMany: async (args: any) =>
          args.where.discordUserId.in
            .filter((id: string) => id in mains)
            .map((id: string) => ({ discordUserId: id, characters: mains[id] })),
      },
      postTracking: {
        findMany: async (args: any) =>
          args?.where?.taskId
            ? rows.filter((r) => r.taskId === args.where.taskId)
            : rows.map((r) => ({ ...r, task: tasks[r.taskId], sourceTask: tasks[r.sourceTaskId] })),
        deleteMany: async (args: any) => void deletedRows.push(...args.where.id.in),
        create: async (args: any) => void created.push(args.data),
        update: async (args: any) => {
          Object.assign(
            rows.find((r) => r.id === args.where.id),
            args.data,
          );
        },
      },
    } as unknown as PrismaService;
    const bot = {
      getBotUserId: async () => BOT,
      getReactionUsers: async (_c: string, _m: string, emoji: string) => {
        if (readFails) throw readFails;
        return reactors[emoji] ?? [];
      },
      editMessage: async (...args: unknown[]) => void edits.push(args),
    } as unknown as DiscordBotService;
    service = new TrackingService(prisma, bot);
  });

  const trackingRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    taskId: POST,
    sourceTaskId: POST,
    postRef: `id:${POST}`,
    emoji: '👍',
    type: 'names',
    lastHash: null,
    lastUsers: [],
    ...over,
  });

  describe('finding the posts a text points at', () => {
    const resolve = (text: string, guild = 'g1', self?: string) =>
      service.resolveSources(guild, parseDynamicTokens(text), self);

    it('finds a post by id, but only in the same guild', async () => {
      const sources = await resolve(`{{reactions post="${POST}" emoji=👍 show=names}}`);
      assert.equal(sources.get(`id:${POST}`), POST);
      await assert.rejects(
        resolve(`{{reactions post="${POST}" emoji=👍 show=names}}`, 'other-guild'),
        /no post with the id/,
      );
    });

    it('finds a post by its name, whatever the letter case', async () => {
      const sources = await resolve('{{reactions post="RAID SIGNUP" emoji=👍}}');
      assert.equal(sources.get('name:raid signup'), POST);
    });

    it('refuses a name nobody has, and a name two posts share', async () => {
      await assert.rejects(resolve('{{reactions post="Nope" emoji=👍}}'), /no post named "Nope"/);
      tasks['22222222-2222-3333-4444-555555555555'] = post({
        id: '22222222-2222-3333-4444-555555555555',
      });
      await assert.rejects(
        resolve('{{reactions post="raid signup" emoji=👍}}'),
        /2 posts are named/,
      );
    });

    it('lets a post point at itself, once it has an id', async () => {
      assert.equal((await resolve('{{reactions emoji=👍}}')).size, 0);
      assert.equal((await resolve('{{reactions emoji=👍}}', 'g1', POST)).get('self'), POST);
    });

    it('keeps what was found on save, so renaming the other post breaks nothing', async () => {
      rows = [trackingRow({ postRef: 'name:old name' })];
      const tokens = parseDynamicTokens('{{reactions post="Old name" emoji=👍}}');
      const sources = await service.sourceMap(POST, 'g1', tokens);
      assert.equal(sources.get('name:old name'), POST);
    });

    it('shows nobody for a tag that points nowhere when posting', async () => {
      const tokens = parseDynamicTokens('{{reactions post="Gone" emoji=👍}}');
      const sources = await service.sourceMap(POST, 'g1', tokens);
      assert.equal(sources.size, 0);
      const people = await service.fetchPeople('g1', tokens, sources);
      assert.deepEqual(people.get('name:gone|👍|names'), []);
    });
  });

  describe('saving', () => {
    const sync = (text: string, people?: Map<string, any>) => {
      const tokens = parseDynamicTokens(text);
      return service.syncTracking(POST, tokens, new Map(tokens.map((t) => [t.ref, POST])), people);
    };

    it('adds a row per tag, and removes rows whose tag is gone', async () => {
      rows = [trackingRow({ id: 'old', emoji: '🔥' })];
      await sync(`{{reactions post="${POST}" emoji=👍 show=names}}`);
      assert.deepEqual(deletedRows, ['old']);
      assert.deepEqual(
        created.map((c) => [c.taskId, c.sourceTaskId, c.postRef, c.emoji, c.type]),
        [[POST, POST, `id:${POST}`, '👍', 'names']],
      );
    });

    it('keeps a row that is still in the text and seeds new rows so nothing looks changed', async () => {
      rows = [trackingRow()];
      const people = new Map([[`id:${POST}|👍|number`, [ana]]]);
      await sync(
        `{{reactions post="${POST}" emoji=👍 show=names}} {{reactions post="${POST}" emoji=👍 show=number}}`,
        people,
      );
      assert.deepEqual(deletedRows, []);
      assert.equal(created.length, 1);
      assert.equal(created[0].lastHash, hashReactors([ana]));
    });

    it('stores tags that point at a post by name with that name as the reference', async () => {
      await sync('{{reactions post="Raid signup" emoji=🔥 show=tags}}');
      assert.deepEqual([created[0].postRef, created[0].type], ['name:raid signup', 'tags']);
    });

    it('removes every row when the tags are removed from the text', async () => {
      rows = [trackingRow()];
      await sync('No tags');
      assert.deepEqual(deletedRows, ['r1']);
    });
  });

  describe('reading reactions', () => {
    it('leaves the bot out', async () => {
      assert.deepEqual(await service.readReactors(tasks[POST], '👍'), [ana, bruno]);
    });

    it('finds nobody for a post that is not in Discord', async () => {
      tasks[POST].state = {};
      assert.deepEqual(await service.readReactors(tasks[POST], '👍'), []);
      assert.deepEqual(await service.readReactors(null, '👍'), []);
    });

    it('finds nobody when the message was deleted, but reports other Discord errors', async () => {
      readFails = new DiscordAPIError(
        { code: 10008, message: 'Unknown Message' },
        10008,
        404,
        'GET',
        '',
        {},
      );
      assert.deepEqual(await service.readReactors(tasks[POST], '👍'), []);
      readFails = new Error('rate limited');
      await assert.rejects(service.readReactors(tasks[POST], '👍'), /rate limited/);
    });
  });

  describe('main character names', () => {
    it("shows each person's main characters, else their Discord name", async () => {
      mains = {
        [ana.id]: [{ firstName: 'Merric', lastName: 'Stone' }],
        [bruno.id]: [],
      };
      const [token] = parseDynamicTokens(`{{reactions post="${POST}" emoji=👍 show=mainNames}}`);
      const people = await service.fetchPeople('g1', [token], new Map([[token.ref, POST]]));
      assert.deepEqual(people.get(`id:${POST}|👍|mainNames`), [
        { id: '1', name: 'Merric Stone' },
        { id: '2', name: 'Bruno' },
      ]);
    });

    it('joins several mains of one person', async () => {
      mains = {
        [ana.id]: [
          { firstName: 'Merric', lastName: '' },
          { firstName: 'Olga', lastName: '' },
        ],
      };
      const people = await service.withMainNames('g1', [ana]);
      assert.equal(people[0].name, 'Merric / Olga');
    });

    it('updates the post when someone gets a main, even if the reactions did not change', async () => {
      tasks[POST].config.content = `Going: {{reactions post="${POST}" emoji=👍 show=mainNames}}`;
      rows = [trackingRow({ type: 'mainNames' })];
      await service.refreshDue();
      assert.equal(edits[0][2], 'Going: Ana, Bruno');
      tasks[POST].state.renderedContent = 'Going: Ana, Bruno';
      mains = { [ana.id]: [{ firstName: 'Merric', lastName: '' }] };
      assert.equal(await service.refreshDue(), 1);
      assert.equal(edits[1][2], 'Going: Merric, Bruno');
    });

    it('does not touch the database for plain names', async () => {
      mains = { [ana.id]: [{ firstName: 'Merric', lastName: '' }] };
      const [token] = parseDynamicTokens(`{{reactions post="${POST}" emoji=👍 show=names}}`);
      const people = await service.fetchPeople('g1', [token], new Map([[token.ref, POST]]));
      assert.equal(people.get(`id:${POST}|👍|names`)?.[0].name, 'Ana');
    });
  });

  describe('custom emoji', () => {
    it('reads reactions of a server emoji written as <:name:id> or <a:name:id>', async () => {
      reactors['raid:123456789012345678'] = [ana];
      for (const written of ['<:raid:123456789012345678>', '<a:raid:123456789012345678>']) {
        const [token] = parseDynamicTokens(
          `{{reactions post="${POST}" emoji=${written} show=names}}`,
        );
        assert.equal(token.emoji, 'raid:123456789012345678');
        const people = await service.fetchPeople('g1', [token], new Map([[token.ref, POST]]));
        assert.deepEqual(people.get(`id:${POST}|raid:123456789012345678|names`), [ana]);
      }
    });
  });

  describe('the worker pass', () => {
    it('edits the post when reactions changed, quietly, and remembers what it wrote', async () => {
      rows = [trackingRow()];
      assert.equal(await service.refreshDue(), 1);
      assert.deepEqual(edits, [
        ['c1', 'm1', 'Going: Ana, Bruno', { suppressEmbeds: false, quiet: true }],
      ]);
      assert.equal(taskUpdates[0].state.renderedContent, 'Going: Ana, Bruno');
      assert.equal(rows[0].lastHash, hashReactors([ana, bruno]));
    });

    it('does nothing more when the hash of who reacted is unchanged', async () => {
      rows = [trackingRow({ lastHash: hashReactors([ana, bruno]), lastUsers: [ana, bruno] })];
      assert.equal(await service.refreshDue(), 0);
      assert.deepEqual([edits, taskUpdates], [[], []]);
    });

    it('updates again when someone un-reacts', async () => {
      rows = [trackingRow()];
      await service.refreshDue();
      tasks[POST].state.renderedContent = 'Going: Ana, Bruno';
      reactors['👍'] = [ana];
      assert.equal(await service.refreshDue(), 1);
      assert.equal(edits[1][2], 'Going: Ana');
    });

    it('skips posts that are not in Discord', async () => {
      tasks[POST].state = { messageId: 'm1', channelId: 'c1', messageDeleted: true };
      rows = [trackingRow()];
      assert.equal(await service.refreshDue(), 0);
      assert.deepEqual(edits, []);
    });

    it('keeps going and leaves the post alone when Discord fails for a moment', async () => {
      rows = [trackingRow()];
      readFails = new Error('Discord is down');
      assert.equal(await service.refreshDue(), 0);
      assert.deepEqual(edits, []);
    });

    it("shows another post's reactions in this post", async () => {
      const source = '99999999-2222-3333-4444-555555555555';
      tasks[source] = post({ id: source, state: { messageId: 'm9', channelId: 'c9' } });
      tasks[POST].config.content = `Signed up: {{reactions post="${source}" emoji=👍 show=number}}`;
      rows = [trackingRow({ sourceTaskId: source, postRef: `id:${source}`, type: 'number' })];
      await service.refreshDue();
      assert.equal(edits[0][0], 'c1');
      assert.equal(edits[0][2], 'Signed up: 2');
    });
  });
});
