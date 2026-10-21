import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { GuildPlugin } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { PluginKindRegistry, type PluginContext } from '../plugins/plugin-kinds';
import type { GuildRecipe, GuildRecipesService } from './guild-recipes.service';
import {
  MAX_MESSAGE,
  characterPageUrl,
  listIntro,
  ProfessionsPostPlugin,
  professionsMessages,
  type Crafter,
  type ProfessionsPostConfig,
} from './professions-post.plugin';

const recipe = (profession: string, id: number, name: string | null, crafterIds: string[]) =>
  ({
    kind: 'spell',
    id,
    name,
    icon: null,
    url: `https://www.wowhead.com/forever/spell=${id}`,
    profession,
    crafterIds,
  }) as GuildRecipe;

// Shivan links to its Guild Assistant page; Bob has none (yet).
const crafters: Record<string, Crafter> = {
  a: {
    name: 'Shivan Nightpath',
    url: 'https://guildassistant.app/forever/eu/rp/characters/Shivan-Nightpath',
  },
  b: { name: 'Bob', url: null },
};
const crafterOf = (id: string): Crafter => crafters[id] ?? { name: id, url: null };
const shivan =
  '[Shivan Nightpath](<https://guildassistant.app/forever/eu/rp/characters/Shivan-Nightpath>)';

describe('professionsMessages', () => {
  it('lists each profession with its recipes and their crafters, linked to their pages', () => {
    const messages = professionsMessages(
      [
        recipe('Blacksmithing', 1245287, 'Copper Rod', ['a', 'b']),
        recipe('Blacksmithing', 2660, 'Rough Sharpening Stone', ['a']),
        recipe('Cooking', 2538, null, ['b']),
      ],
      crafterOf,
      listIntro('https://guildassistant.app/forever/eu/firemaw/guilds/relic-hunters/professions'),
    );
    assert.deepEqual(messages, [
      [
        '# Profession Data',
        'This list updates by itself. Add your professions on [Guild Assistant](<https://guildassistant.app/forever/eu/firemaw/guilds/relic-hunters/professions>) (Import professions).',
        'Find who can craft something with `/crafter <recipe name>` anywhere on Discord, or with Discord’s search.',
        '',
        '## Blacksmithing',
        // Escaped brackets: Discord shows "[Bob, Shivan Nightpath]" around the links.
        `- [Copper Rod](<https://www.wowhead.com/forever/spell=1245287>): Crafters: \\[Bob, ${shivan}\\]`,
        `- [Rough Sharpening Stone](<https://www.wowhead.com/forever/spell=2660>): Crafters: \\[${shivan}\\]`,
        '## Cooking',
        '- [Spell 2538](<https://www.wowhead.com/forever/spell=2538>): Crafters: \\[Bob\\]',
      ].join('\n'),
    ]);
  });

  it('splits a long list between messages at line ends, carrying on the list without a heading', () => {
    const recipes = [
      ...Array.from({ length: 60 }, (_, i) =>
        recipe('Blacksmithing', 1000 + i, `Blacksmithing recipe ${i}`, ['a', 'b']),
      ),
      ...Array.from({ length: 60 }, (_, i) =>
        recipe('Tailoring', 2000 + i, `Tailoring recipe ${i}`, ['b']),
      ),
    ];
    const messages = professionsMessages(recipes, crafterOf);
    assert.ok(messages.length > 2, `${messages.length} messages`);
    for (const message of messages) {
      assert.ok(message.length <= MAX_MESSAGE, `${message.length} characters`);
      const lines = message.split('\n');
      assert.ok(!lines[lines.length - 1].startsWith('## '), 'never a heading alone at the end');
      for (const line of lines) assert.match(line, /^(## |- \[)/, 'whole lines only');
    }
    // A profession carried on into the next message just goes on with its recipes.
    assert.ok(messages.slice(1).some((m) => m.startsWith('- [Blacksmithing recipe')));
    assert.ok(!messages.join('\n').includes('(continued)'));
    // Every recipe once, in order.
    const listed = messages.join('\n').match(/recipe \d+/g) ?? [];
    assert.equal(listed.length, 120);
  });

  it('shortens the crafters of a line too long for one message, linking to the rest', () => {
    const many = Array.from({ length: 200 }, (_, i) => `crafter-with-a-long-name-${i}`);
    const [message] = professionsMessages(
      [recipe('Cooking', 2538, 'Bread', many)],
      crafterOf,
      '',
      (r) => `https://guildassistant.app/g/professions/${r.id}/crafters`,
    );
    assert.ok(message.length <= MAX_MESSAGE);
    assert.match(
      message,
      /, \[\d+ more\]\(<https:\/\/guildassistant\.app\/g\/professions\/2538\/crafters>\)\\\]$/,
    );
    // Without the website's address: plain text.
    const [plain] = professionsMessages([recipe('Cooking', 2538, 'Bread', many)], crafterOf);
    assert.match(plain, /, \d+ more\\\]$/);
  });

  it('says so when nobody imported professions', () => {
    assert.deepEqual(professionsMessages([], crafterOf), [
      'Nobody in the guild has imported their professions yet.',
    ]);
  });
});

describe('characterPageUrl', () => {
  it("is the character's page on Guild Assistant, as the website addresses it", () => {
    const server = { gameVersion: 'Forever', region: 'EU', realm: 'RP' };
    assert.equal(
      characterPageUrl('https://guildassistant.app', server, {
        firstName: 'Shivan',
        lastName: 'Nightpath',
      }),
      'https://guildassistant.app/forever/eu/rp/characters/Shivan-Nightpath',
    );
    assert.equal(
      characterPageUrl('https://guildassistant.app', server, { firstName: 'Bob', lastName: '' }),
      'https://guildassistant.app/forever/eu/rp/characters/Bob',
    );
  });
});

describe('ProfessionsPostPlugin', () => {
  function setup(recipes: GuildRecipe[], failAfter = Infinity) {
    const posted: { id: string; content: string }[] = [];
    const edited: { id: string; content: string }[] = [];
    const deleted: string[] = [];
    // Messages someone deleted by hand: editing them fails.
    const gone = new Set<string>();
    let next = 0;
    const bot = {
      postQuietMessage: async (
        _channel: string,
        content: string,
        options: { suppressEmbeds?: boolean },
      ) => {
        if (posted.length >= failAfter) throw new Error('Discord is down');
        // No previews: Discord would show a profile card for each crafter's link.
        assert.equal(options.suppressEmbeds, true);
        const id = `m${++next}`;
        posted.push({ id, content });
        return id;
      },
      editMessage: async (
        _channel: string,
        id: string,
        content: string,
        options: { suppressEmbeds?: boolean; quiet?: boolean },
      ) => {
        if (gone.has(id)) throw new Error('Unknown Message');
        assert.equal(options.suppressEmbeds, true);
        assert.equal(options.quiet, true);
        edited.push({ id, content });
      },
      deleteMessage: async (_channel: string, id: string) => {
        deleted.push(id);
      },
    } as unknown as DiscordBotService;
    const guildRecipes = {
      guildRecipes: async () => ({
        recipes,
        characters: [
          {
            id: 'a',
            name: 'Shivan Nightpath',
            firstName: 'Shivan',
            lastName: 'Nightpath',
            class: 'WARRIOR',
            discordUserId: '123',
            professions: [],
          },
          { id: 'b', name: 'Bob', firstName: 'Bob', lastName: '', class: 'MAGE', professions: [] },
        ],
        owners: new Map(),
      }),
    } as unknown as GuildRecipesService;
    const prisma = {
      guild: {
        findUniqueOrThrow: async () => ({
          gameVersion: 'Forever',
          region: 'eu',
          realm: 'Firemaw',
          name: 'Relic Hunters',
        }),
      },
    } as unknown as PrismaService;
    const plugin = new ProfessionsPostPlugin(new PluginKindRegistry(), guildRecipes, prisma, {
      get: () => undefined,
    } as unknown as ConfigService);
    const context = { bot, guildId: 'g1', serverIds: ['s1'], clock: Date.now } as PluginContext;
    const run = (state: Record<string, unknown>) =>
      plugin.def.run(
        {
          guildId: 'g1',
          state,
          config: { serverId: 's1', channelId: 'c1' },
        } as unknown as Omit<GuildPlugin, 'config'> & { config: ProfessionsPostConfig },
        context,
        Date.now() + 60_000,
      );
    return { run, plugin, posted, edited, deleted, gone };
  }

  const rod = recipe('Blacksmithing', 1245287, 'Copper Rod', ['a']);

  it('posts the list, then does nothing until it changes', async () => {
    const { run, posted, deleted } = setup([rod]);
    const first = await run({});
    assert.equal(first.result, 'Posted the list: 1 recipe in 1 message.');
    assert.equal(posted.length, 1);
    // Crafters link to their Guild Assistant page, never a Discord profile (Discord shows a card).
    assert.match(
      posted[0].content,
      /\(<https:\/\/guildassistant\.app\/forever\/eu\/firemaw\/characters\/Shivan-Nightpath>\)/,
    );
    assert.doesNotMatch(posted[0].content, /discord\.com\/users/);
    // The intro links to the guild's Professions page.
    assert.match(
      posted[0].content,
      /\(<https:\/\/guildassistant\.app\/forever\/eu\/firemaw\/guilds\/relic-hunters\/professions>\)/,
    );
    const second = await run(first.state);
    assert.equal(second.result, 'No changes.');
    assert.equal(posted.length, 1);
    assert.deepEqual(deleted, []);
  });

  it('"Run now" posts the list again even when nothing changed', async () => {
    const { run, plugin, posted, deleted } = setup([rod]);
    const first = await run({});
    const forced = await run(plugin.def.onRunNow!(first.state));
    assert.deepEqual(deleted, ['m1'], 'the previous list is deleted');
    assert.equal(posted.length, 2, 'and posted again');
    assert.equal(forced.state.force, undefined, 'only that once');
    assert.equal((await run(forced.state)).result, 'No changes.');
  });

  it('edits its messages in place when the list changed and still fits, dropping spare ones', async () => {
    const { run, posted, edited, deleted } = setup([rod, recipe('Cooking', 2538, 'Bread', ['b'])]);
    const outcome = await run({ hash: 'old', messageIds: ['old1', 'old2'] });
    // Nothing new in the channel: the first message now holds the list, the second goes.
    assert.deepEqual(
      edited.map((e) => e.id),
      ['old1'],
    );
    assert.match(edited[0].content, /Bread/);
    assert.deepEqual(deleted, ['old2']);
    assert.equal(posted.length, 0);
    assert.deepEqual(outcome.state.messageIds, ['old1']);
    assert.equal(outcome.result, 'Updated the list: 2 recipes in 1 message.');
  });

  it('posts it all again when the list needs more messages than it has', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      recipe('Blacksmithing', 1000 + i, `Blacksmithing recipe ${i}`, ['a', 'b']),
    );
    const { run, posted, edited, deleted } = setup(many);
    await run({ hash: 'old', messageIds: ['old1'] });
    assert.deepEqual(edited, []);
    assert.deepEqual(deleted, ['old1']);
    assert.ok(posted.length > 1);
  });

  it('posts it all again when one of its messages was deleted by hand', async () => {
    const { run, posted, deleted, gone } = setup([rod]);
    gone.add('old1');
    const outcome = await run({ hash: 'old', messageIds: ['old1'] });
    assert.deepEqual(deleted, ['old1']);
    assert.deepEqual(outcome.state.messageIds, [posted[0].id]);
  });

  it('takes back a half-posted list when Discord fails, so the retry starts clean', async () => {
    const recipes = Array.from({ length: 120 }, (_, i) =>
      recipe('Blacksmithing', 1000 + i, `Blacksmithing recipe ${i}`, ['a', 'b']),
    );
    const { run, deleted } = setup(recipes, 1);
    await assert.rejects(run({}), /Discord is down/);
    assert.deepEqual(deleted, ['m1']);
  });
});
