import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DiscordAPIError } from '@discordjs/rest';
import type { ConfigService } from '@nestjs/config';
import type { CacheService } from '../cache/cache.service';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { PluginKindRegistry } from '../plugins/plugin-kinds';
import {
  answerLines,
  CrafterListenerService,
  type ChatMessage,
  type ProfessionListenerConfig,
} from './crafter-listener.service';
import { DEFAULT_PHRASES } from './crafter-question';
import type { GuildRecipesService } from './guild-recipes.service';

const FLASK_URL = 'https://www.wowhead.com/classic/spell=17635/flask-of-the-titans';

const professions = {
  characters: [
    {
      id: 'c1',
      name: 'Svajone Potato',
      firstName: 'Svajone',
      lastName: 'Potato',
      class: 'Mage',
      discordUserId: '111',
      discordName: 'Svajone',
      professions: [],
    },
    {
      id: 'c2',
      name: 'Bob Builder',
      firstName: 'Bob',
      lastName: 'Builder',
      class: 'Warrior',
      discordUserId: null,
      discordName: null,
      professions: [],
    },
  ],
  recipes: [
    {
      kind: 'spell' as const,
      id: 17635,
      name: 'Flask of the Titans',
      icon: null,
      url: FLASK_URL,
      profession: 'Alchemy',
      crafterIds: ['c1', 'c2'],
    },
  ],
  owners: new Map([['c1', '111']]),
};

function setup(
  config: Partial<ProfessionListenerConfig> = {},
  options: {
    dmFails?: Error;
    replyFails?: Error;
    characters?: { player: { discordUserId: string } | null }[];
  } = {},
) {
  const dms: { userId: string; content: string }[] = [];
  const posts: { channelId: string; content?: string; replyTo?: string }[] = [];
  const runs: { status: string; result: string | null; error: string | null }[] = [];
  // What the plugin's card says: only updated by answers, not by repeats left unanswered.
  const cards: { lastStatus: string; lastResult: string }[] = [];
  const prisma = {
    character: { findMany: async () => options.characters ?? [] },
    pluginRun: {
      create: async ({ data }: { data: (typeof runs)[number] }) => {
        runs.push({ status: data.status, result: data.result, error: data.error });
      },
    },
    guildPlugin: {
      update: async ({ data }: { data: (typeof cards)[number] }) => {
        cards.push({ lastStatus: data.lastStatus, lastResult: data.lastResult });
        return {};
      },
    },
  };
  const bot = {
    sendDirectText: async (userId: string, content: string) => {
      if (options.dmFails) throw options.dmFails;
      dms.push({ userId, content });
    },
    sendRichMessage: async (channelId: string, message: { content?: string; replyTo?: string }) => {
      if (message.replyTo && options.replyFails) throw options.replyFails;
      posts.push({ channelId, ...message });
      return 'reply-1';
    },
  };
  const service = new CrafterListenerService(
    new PluginKindRegistry(),
    { guildRecipes: async () => professions } as unknown as GuildRecipesService,
    prisma as unknown as PrismaService,
    bot as unknown as DiscordBotService,
    {} as CacheService,
    {} as ConfigService,
  );
  service.setListeners([
    {
      id: 'p1',
      guildId: 'g1',
      name: 'Guild chat',
      config: {
        serverId: 's1',
        channelId: 'chat',
        phrases: [...DEFAULT_PHRASES],
        sendDm: true,
        postInChannel: false,
        ...config,
      },
    },
  ]);
  const configure = (more: Partial<ProfessionListenerConfig>) =>
    service.setListeners([
      {
        id: 'p1',
        guildId: 'g1',
        name: 'Guild chat',
        config: {
          serverId: 's1',
          channelId: 'chat',
          phrases: [...DEFAULT_PHRASES],
          sendDm: true,
          postInChannel: false,
          ...config,
          ...more,
        },
      },
    ]);
  return { service, dms, posts, runs, cards, configure };
}

const message = (text: string, more: Partial<ChatMessage> = {}): ChatMessage => ({
  serverId: 's1',
  channelId: 'chat',
  messageId: 'm1',
  text,
  authorId: '999',
  authorName: 'Freya',
  relayed: false,
  relayName: null,
  replyable: true,
  ...more,
});

const LINES =
  `- [Svajone](<https://discord.com/users/111>) can craft [Flask of the Titans](<${FLASK_URL}>) with character Svajone Potato\n` +
  `- Bob Builder can craft [Flask of the Titans](<${FLASK_URL}>) (no Discord account linked)`;

describe('Guild Chat Profession Listener', () => {
  it('DMs whoever asks who can craft it, and logs the answer', async () => {
    const { service, dms, posts, runs } = setup();
    await service.handle(message('who can craft flask of titans?'));
    assert.deepEqual(dms, [
      {
        userId: '999',
        content: `Who can craft what you [asked about](<https://discord.com/channels/s1/chat/m1>):\n${LINES}`,
      },
    ]);
    assert.deepEqual(posts, []);
    assert.deepEqual(runs, [
      {
        status: 'SUCCESS',
        result: 'Freya asked “who can craft” about Flask of the Titans: 2 crafters, sent a DM.',
        error: null,
      },
    ]);
  });

  it('answers in the channel too, as a reply, when set to', async () => {
    const { service, dms, posts } = setup({ postInChannel: true });
    await service.handle(message('LF crafter [Flask of the Titans]'));
    assert.equal(dms.length, 1);
    assert.deepEqual(posts, [
      { channelId: 'chat', content: LINES, replyTo: 'm1', suppressEmbeds: true },
    ]);
  });

  it('only in the channel when DMs are off', async () => {
    const { service, dms, posts } = setup({ sendDm: false, postInChannel: true });
    await service.handle(message('who can make flask of the titans'));
    assert.equal(dms.length, 0);
    assert.equal(posts.length, 1);
  });

  it('answers the same question from the same person once in 10 minutes', async () => {
    const { service, dms } = setup();
    const now = Date.now();
    await service.handle(message('who can craft flask of titans'), now);
    await service.handle(message('who can craft flask of the titans?'), now + 60_000);
    assert.equal(dms.length, 1);
    await service.handle(message('who can craft flask of titans'), now + 11 * 60_000);
    assert.equal(dms.length, 2);
  });

  it('says in the Log when it leaves a repeat unanswered, without changing the card', async () => {
    const { service, runs, cards } = setup();
    const now = Date.now();
    await service.handle(message('who can craft flask of titans'), now);
    await service.handle(message('LF crafter [Flask of the Titans]'), now + 60_000);
    assert.equal(runs.length, 2);
    assert.equal(
      runs[1].result,
      'Freya asked about Flask of the Titans again: answered less than 10 minutes ago, so not again yet.',
    );
    assert.equal(cards.length, 1);
  });

  it('only counts an answer that was delivered: a refused DM is tried again', async () => {
    const options: { dmFails?: Error } = {
      dmFails: new DiscordAPIError(
        { message: 'Cannot send messages to this user', code: 50007 },
        50007,
        403,
        'POST',
        'u',
        {},
      ),
    };
    const { service, dms } = setup({}, options);
    const now = Date.now();
    await service.handle(message('who can craft flask of titans'), now);
    options.dmFails = undefined;
    await service.handle(message('who can craft flask of titans'), now + 60_000);
    assert.equal(dms.length, 1);
  });

  it('counts DMs and channel answers apart: switched from the channel to DMs, the DM goes', async () => {
    const { service, posts, dms, configure } = setup({ sendDm: false, postInChannel: true });
    const now = Date.now();
    await service.handle(message('who can craft flask of titans'), now);
    configure({ sendDm: true, postInChannel: false });
    await service.handle(message('who can craft flask of titans'), now + 60_000);
    assert.equal(posts.length, 1);
    assert.equal(dms.length, 1);
  });

  it('answers the game’s guild chat (posted by an app as the player) with a message of its own', async () => {
    const { service, posts, dms } = setup({ postInChannel: true });
    await service.handle(
      message('LF crafter [Flask of the Titans]', { authorName: 'Shivan', replyable: false }),
    );
    assert.equal(dms[0]?.userId, '999');
    assert.deepEqual(posts, [
      { channelId: 'chat', content: `For <@999>:\n${LINES}`, suppressEmbeds: true },
    ]);
  });

  it('posts a message of its own when Discord refuses the reply', async () => {
    const refused = new DiscordAPIError(
      { message: 'This action requires an application to be authorized by the user.', code: 0 },
      0,
      400,
      'POST',
      'u',
      {},
    );
    const { service, posts, runs } = setup(
      { sendDm: false, postInChannel: true },
      { replyFails: refused },
    );
    await service.handle(message('who can craft flask of titans'));
    assert.deepEqual(posts, [
      { channelId: 'chat', content: `For <@999>:\n${LINES}`, suppressEmbeds: true },
    ]);
    assert.equal(runs[0].status, 'SUCCESS');
  });

  it('stays quiet for other messages, other channels and recipes nobody has', async () => {
    const { service, dms, runs } = setup();
    await service.handle(message('just made a flask of the titans'));
    await service.handle(message('who can craft flask of titans', { channelId: 'other' }));
    await service.handle(message('who can craft thorium bar'));
    assert.equal(dms.length, 0);
    assert.equal(runs.length, 0);
  });

  it('logs a DM Discord refused as a failure', async () => {
    const refused = new DiscordAPIError(
      { message: 'Cannot send messages to this user', code: 50007 },
      50007,
      403,
      'POST',
      'u',
      {},
    );
    const { service, runs } = setup({}, { dmFails: refused });
    await service.handle(message('who can craft flask of titans'));
    assert.equal(runs[0].status, 'FAILED');
    assert.equal(
      runs[0].error,
      'Could not DM Freya: they don’t accept direct messages from this server.',
    );
  });

  it('finds who asked in game chat relayed by a bot, by character name', async () => {
    const { service, dms } = setup({}, { characters: [{ player: { discordUserId: '222' } }] });
    await service.handle(
      message('Kael: who can craft [Flask of the Titans]', {
        relayed: true,
        authorId: 'relay-bot',
      }),
    );
    assert.equal(dms[0]?.userId, '222');
  });

  it('answers someone from the game with no Discord account only in the channel', async () => {
    const dmOnly = setup();
    await dmOnly.service.handle(
      message('Kael: who can craft flask of titans', { relayed: true, authorId: 'relay-bot' }),
    );
    assert.equal(dmOnly.dms.length + dmOnly.posts.length + dmOnly.runs.length, 0);

    const both = setup({ postInChannel: true });
    await both.service.handle(
      message('Kael: who can craft flask of titans', { relayed: true, authorId: 'relay-bot' }),
    );
    assert.equal(both.dms.length, 0);
    assert.equal(both.posts.length, 1);
    assert.match(
      both.runs[0].result ?? '',
      /^Kael asked .*no DM \(no Discord account linked\), answered in the channel\.$/,
    );
  });
});

describe('answerLines', () => {
  it('names a player with several characters once, and cuts what does not fit', () => {
    const lines = answerLines([
      {
        name: 'Copper Rod',
        url: 'u',
        crafters: [
          { character: 'A One', discordUserId: '1', discordName: 'a_b' },
          { character: 'A Two', discordUserId: '1', discordName: 'a_b' },
        ],
      },
      { name: 'R2', url: 'u', crafters: [] },
      { name: 'R3', url: 'u', crafters: [] },
      { name: 'R4', url: 'u', crafters: [] },
    ]);
    assert.equal(
      lines,
      '- [a\\_b](<https://discord.com/users/1>) can craft [Copper Rod](<u>) with characters A One and A Two\n' +
        '…and 1 more recipe match: ask with the full name, or use `/crafter`.',
    );
  });
});
