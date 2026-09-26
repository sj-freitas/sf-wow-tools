import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_SHOW,
  hashReactors,
  parseAllTokens,
  parseDynamicTokens,
  renderContent,
  trackingKey,
  type Reactor,
} from './dynamic-content';

const POST = '900000000000000001';
const LINK =
  'https://discord.com/channels/100000000000000001/800000000000000002/900000000000000003';
const ana: Reactor = { id: '100000000000000001', name: 'Ana' };
const bruno: Reactor = { id: '100000000000000002', name: 'Bruno' };

describe('parseDynamicTokens', () => {
  it('reads the source, the emoji and the expression, for unicode and custom emoji', () => {
    const tokens = parseDynamicTokens(
      `Going: {{reactions sourcePost=${POST} emoji=👍 show="reactions.length"}} and {{reactions sourcePost="Roster" emoji=<:raid:123456789012345678> show=reactions.length}}`,
    );
    assert.deepEqual(
      tokens.map((t) => [t.ref, t.emoji, t.expression]),
      [
        [`msgid:${POST}`, '👍', 'reactions.length'],
        ['name:roster#1', 'raid:123456789012345678', 'reactions.length'],
      ],
    );
    assert.equal(
      tokens[0].raw,
      `{{reactions sourcePost=${POST} emoji=👍 show="reactions.length"}}`,
    );
  });

  it('shows the Discord names when show is left out', () => {
    const [token] = parseDynamicTokens('{{reactions emoji=👍}}');
    assert.equal(token.expression, DEFAULT_SHOW);
  });

  it('takes show as it is: a word is an expression, not a keyword', () => {
    const [token] = parseDynamicTokens('{{reactions emoji=👍 show=names}}');
    assert.equal(token.expression, 'names');
  });

  it('finds nothing in ordinary text', () => {
    assert.deepEqual(parseDynamicTokens('Raid at [20:00] [link](https://x.y)'), []);
  });

  it('refuses a tag that is written wrongly instead of posting it as text', () => {
    for (const bad of [
      '{{reactions sourcePost="A"}}',
      '{{reactions emoji=abc}}',
      '{{reactions emoji=👍 colour=red}}',
      '{{reactions emoji=👍 emoji=🔥}}',
      '{{reactions emoji=👍 stray}}',
      '{{reactions emoji=👍 show="unclosed}}',
      '{{reactions emoji=👍',
      '{{reactions emoji=👍 show=}}',
      '{{reactions emoji=👍 show=""}}',
    ]) {
      assert.throws(() => parseDynamicTokens(bad), BadRequestException, bad);
    }
  });

  it('no longer accepts the old post= option', () => {
    assert.throws(
      () => parseDynamicTokens('{{reactions post="Raid" emoji=👍}}'),
      /"post", which is not an option here/,
    );
  });

  it('allows at most five tags', () => {
    const tag = `{{reactions sourcePost=${POST} emoji=👍}}`;
    assert.equal(parseDynamicTokens(Array(5).fill(tag).join(' ')).length, 5);
    assert.throws(() => parseDynamicTokens(Array(6).fill(tag).join(' ')), /at most 5/);
  });

  it('points at a post by name, in any order, with a quoted or bare value', () => {
    const [a, b] = parseDynamicTokens(
      'Yes: {{reactions sourcePost="Raid Signup" emoji=👍 show="reactions.length"}} and {{reactions show=reactions.length emoji=👍 sourcePost=Roster}}',
    );
    assert.deepEqual([a.ref, a.label, a.emoji], ['name:raid signup#1', 'Raid Signup', '👍']);
    assert.equal(b.ref, 'name:roster#1');
  });

  it('points at the post itself when sourcePost is left out', () => {
    const [self] = parseDynamicTokens('{{ reactions emoji=🔥 }}');
    assert.equal(self.ref, 'self#1');
  });

  it('reads a tag in the third message of a post as reading that same message', () => {
    const [own] = parseDynamicTokens('{{reactions emoji=👍}}', 3);
    assert.deepEqual([own.ref, own.part], ['self#3', 3]);
  });

  it('reads another post’s first message, unless part says which', () => {
    const [first, second] = parseDynamicTokens(
      '{{reactions sourcePost="Raid" emoji=👍}} {{reactions sourcePost="Raid" part=2 emoji=👍}}',
      3,
    );
    assert.deepEqual([first.ref, first.part], ['name:raid#1', 1]);
    assert.deepEqual([second.ref, second.part], ['name:raid#2', 2]);
    assert.notEqual(first.ref, second.ref);
  });

  it('refuses a part that is not a message number, or given for a message id or link', () => {
    for (const bad of [
      '{{reactions part=0 emoji=👍}}',
      '{{reactions part=11 emoji=👍}}',
      '{{reactions part=x emoji=👍}}',
      '{{reactions sourcePost=900000000000000001 part=2 emoji=👍}}',
    ]) {
      assert.throws(() => parseDynamicTokens(bad), BadRequestException, bad);
    }
  });

  it('reads every message of a post, each tag knowing which message it is in', () => {
    const tokens = parseAllTokens([
      { content: 'One {{reactions emoji=👍}}' },
      { content: 'Two, no tags' },
      { content: 'Three {{reactions emoji=🔥}}' },
    ]);
    assert.deepEqual(
      tokens.map((t) => t.ref),
      ['self#1', 'self#3'],
    );
  });

  it('points at a Discord message by its id', () => {
    const [token] = parseDynamicTokens('{{reactions sourcePost=900000000000000001 emoji=👍}}');
    assert.equal(token.ref, 'msgid:900000000000000001');
    assert.equal(token.message, undefined);
  });

  it('points at any Discord message by its link', () => {
    for (const host of ['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com']) {
      const link = LINK.replace('discord.com', host);
      const [token] = parseDynamicTokens(`{{reactions sourcePost="${link}" emoji=👍}}`);
      assert.equal(token.ref, 'msg:800000000000000002/900000000000000003', host);
      assert.deepEqual(token.message, {
        serverId: '100000000000000001',
        channelId: '800000000000000002',
        messageId: '900000000000000003',
      });
    }
  });

  it('treats a link to something else as a post name', () => {
    const [token] = parseDynamicTokens(
      '{{reactions sourcePost="https://example.com/channels/1/2/3" emoji=👍}}',
    );
    assert.match(token.ref, /^name:/);
  });

  it('keeps the tags in text order', () => {
    const tokens = parseDynamicTokens(
      `{{reactions sourcePost=${POST} emoji=👍}} then {{reactions sourcePost=A emoji=<:raid:123456789012345678>}}`,
    );
    assert.deepEqual(
      tokens.map((t) => t.emoji),
      ['👍', 'raid:123456789012345678'],
    );
  });

  it('reads an expression with quotes, backticks, ${…} and }} inside', () => {
    const expression =
      "`${reactions.length}: ${reactions.map((a) => `${a.tag} is ${a.name}`).join(', ')}`";
    const text = `Going {{reactions sourcePost="Raid" emoji=👍 show="${expression}"}} and more {{reactions emoji=🔥}}`;
    const tokens = parseDynamicTokens(text);
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0].expression, expression);
    assert.equal(tokens[0].raw, `{{reactions sourcePost="Raid" emoji=👍 show="${expression}"}}`);
    assert.equal(tokens[1].emoji, '🔥');
  });

  it('lets \\" stand for a double quote inside the expression', () => {
    const [token] = parseDynamicTokens('{{reactions emoji=👍 show="\\"a\\" + reactions.length"}}');
    assert.equal(token.expression, '"a" + reactions.length');
  });

  it('leaves other double-brace text alone', () => {
    assert.deepEqual(parseDynamicTokens('{{something else}} {{reactionsfoo}}'), []);
  });
});

describe('renderContent', () => {
  const tag = (show: string) => `{{reactions sourcePost="A" emoji=👍 show="${show}"}}`;
  const people = (token: { ref: string; emoji: string }, list: Reactor[]) =>
    new Map([[trackingKey(token), list]]);

  it('replaces every occurrence of the tag with what its expression gives', async () => {
    const text = `Yes: ${tag('reactions.map(r => r.name)')}\nAgain: ${tag('reactions.map(r => r.name)')}`;
    const tokens = parseDynamicTokens(text);
    assert.equal(
      await renderContent(text, tokens, people(tokens[0], [ana, bruno])),
      'Yes: Ana, Bruno\nAgain: Ana, Bruno',
    );
  });

  it('writes the default (Discord names) when show is left out', async () => {
    const text = 'Going: {{reactions sourcePost="A" emoji=👍}}';
    const tokens = parseDynamicTokens(text);
    assert.equal(
      await renderContent(text, tokens, people(tokens[0], [ana, bruno])),
      'Going: Ana, Bruno',
    );
  });

  it('gives the expression an empty list when the people are unknown', async () => {
    const text = tag('reactions.length');
    const tokens = parseDynamicTokens(text);
    assert.equal(await renderContent(text, tokens, new Map()), '0');
  });

  it('leaves text without tags alone', async () => {
    assert.equal(await renderContent('Hello', [], new Map()), 'Hello');
  });

  it('cuts a message that would not fit in Discord', async () => {
    const text = `${'a'.repeat(1500)} ${tag("'x'.repeat(1000)")}`;
    const tokens = parseDynamicTokens(text);
    const out = await renderContent(text, tokens, new Map());
    assert.equal(out.length, 2000);
  });
});

describe('hashReactors', () => {
  it('is the same for the same people in any order, and changes when someone joins, renames or their characters change', () => {
    assert.equal(hashReactors([ana, bruno]), hashReactors([bruno, ana]));
    assert.notEqual(hashReactors([ana]), hashReactors([ana, bruno]));
    assert.notEqual(hashReactors([ana]), hashReactors([{ ...ana, name: 'Anna' }]));
    assert.notEqual(
      hashReactors([ana]),
      hashReactors([
        {
          ...ana,
          characters: [
            {
              name: 'Merric',
              firstName: 'Merric',
              lastName: '',
              isMain: true,
              class: 'Warrior',
              roles: ['Tank'],
              level: 60,
            },
          ],
        },
      ]),
    );
  });
});
