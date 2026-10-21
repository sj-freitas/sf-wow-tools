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

// Shivan's player is known on Discord; Bob's isn't (yet).
const crafters: Record<string, Crafter> = {
  a: { name: 'Shivan Nightpath', discordUserId: '123' },
  b: { name: 'Bob', discordUserId: null },
};
const crafterOf = (id: string): Crafter => crafters[id] ?? { name: id, discordUserId: null };
const shivan = '[Shivan Nightpath](<https://discord.com/users/123>)';

describe('professionsMessages', () => {
  it('lists each profession with its recipes and their crafters, linked to Discord', () => {
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
        `- [Copper Rod](<https://www.wowhead.com/forever/spell=1245287>): Crafters: Bob, ${shivan}`,
        `- [Rough Sharpening Stone](<https://www.wowhead.com/forever/spell=2660>): Crafters: ${shivan}`,
        '## Cooking',
        '- [Spell 2538](<https://www.wowhead.com/forever/spell=2538>): Crafters: Bob',
      ].join('\n'),
    ]);
  });

  it('splits a long list between messages at line ends, repeating the heading carried on', () => {
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
      assert.ok(lines[0].startsWith('## '), 'each message starts with a heading');
      assert.ok(!lines[lines.length - 1].startsWith('## '), 'never a heading alone at the end');
      for (const line of lines) assert.match(line, /^(## |- \[)/, 'whole lines only');
    }
    assert.ok(messages.some((m) => m.startsWith('## Blacksmithing (continued)')));
    // Every recipe once, in order.
    const listed = messages.join('\n').match(/recipe \d+/g) ?? [];
    assert.equal(listed.length, 120);
  });

  it('shortens the crafters of a line too long for one message', () => {
    const many = Array.from({ length: 200 }, (_, i) => `crafter-with-a-long-name-${i}`);
    const [message] = professionsMessages([recipe('Cooking', 2538, 'Bread', many)], crafterOf);
    assert.ok(message.length <= MAX_MESSAGE);
    assert.match(message, / and \d+ more$/);
  });

  it('says so when nobody imported professions', () => {
    assert.deepEqual(professionsMessages([], crafterOf), [
      'Nobody in the guild has imported their professions yet.',
    ]);
  });
});

describe('ProfessionsPostPlugin', () => {
  function setup(recipes: GuildRecipe[], failAfter = Infinity) {
    const posted: { id: string; content: string }[] = [];
    const deleted: string[] = [];
    let next = 0;
    const bot = {
      postQuietMessage: async (_channel: string, content: string) => {
        if (posted.length >= failAfter) throw new Error('Discord is down');
        const id = `m${++next}`;
        posted.push({ id, content });
        return id;
      },
      deleteMessage: async (_channel: string, id: string) => {
        deleted.push(id);
      },
    } as unknown as DiscordBotService;
    const guildRecipes = {
      guildRecipes: async () => ({
        recipes,
        characters: [
          { id: 'a', name: 'Shivan Nightpath', class: 'WARRIOR', professions: [] },
          { id: 'b', name: 'Bob', class: 'MAGE', professions: [] },
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
    return { run, posted, deleted };
  }

  const rod = recipe('Blacksmithing', 1245287, 'Copper Rod', ['a']);

  it('posts the list, then does nothing until it changes', async () => {
    const { run, posted, deleted } = setup([rod]);
    const first = await run({});
    assert.equal(first.result, 'Posted the list: 1 recipe in 1 message.');
    assert.equal(posted.length, 1);
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

  it('deletes its previous messages and posts again when the list changed', async () => {
    const { run, posted, deleted } = setup([rod, recipe('Cooking', 2538, 'Bread', ['b'])]);
    const outcome = await run({ hash: 'old', messageIds: ['old1', 'old2'] });
    assert.deepEqual(deleted, ['old1', 'old2']);
    assert.equal(posted.length, 1);
    assert.deepEqual(outcome.state.messageIds, ['m1']);
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
