import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  formatReactors,
  hashReactors,
  parseDynamicTokens,
  renderContent,
  trackingKey,
  type Reactor,
} from './dynamic-content';

const POST = '11111111-2222-3333-4444-555555555555';
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ana: Reactor = { id: '100000000000000001', name: 'Ana' };
const bruno: Reactor = { id: '100000000000000002', name: 'Bruno' };

describe('parseDynamicTokens', () => {
  it('reads the post, the emoji and the format, for unicode and custom emoji', () => {
    const tokens = parseDynamicTokens(
      `Going: {{reactions sourcePost="${POST}" emoji=👍 show=names}} and {{reactions sourcePost="${OTHER}" emoji=<:raid:123456789012345678> show=number}}`,
    );
    assert.deepEqual(
      tokens.map((t) => [t.ref, t.emoji, t.format]),
      [
        [`name:${POST}`, '👍', 'names'],
        [`name:${OTHER}`, 'raid:123456789012345678', 'number'],
      ],
    );
    assert.equal(tokens[0].raw, `{{reactions sourcePost="${POST}" emoji=👍 show=names}}`);
  });

  it('reads the mainNames format', () => {
    const [token] = parseDynamicTokens(
      `{{reactions sourcePost="${POST}" emoji=👍 show=mainNames}}`,
    );
    assert.equal(token.format, 'mainNames');
  });

  it('no longer reads the old [reactions:…] form: it is ordinary text', () => {
    assert.deepEqual(parseDynamicTokens(`[reactions:${POST},👍,names]`), []);
  });

  it('finds nothing in ordinary text', () => {
    assert.deepEqual(parseDynamicTokens('Raid at [20:00] [link](https://x.y)'), []);
  });

  it('refuses a tag that is written wrongly instead of posting it as text', () => {
    for (const bad of [`{{reactions sourcePost="${POST}" emoji=abc show=names}}`]) {
      assert.throws(() => parseDynamicTokens(bad), BadRequestException, bad);
    }
  });

  it('allows at most five tags', () => {
    const tag = `{{reactions sourcePost="${POST}" emoji=👍 show=names}}`;
    assert.equal(parseDynamicTokens(Array(5).fill(tag).join(' ')).length, 5);
    assert.throws(() => parseDynamicTokens(Array(6).fill(tag).join(' ')), /at most 5/);
  });
});

describe('the {{reactions …}} syntax', () => {
  it('points at a post by name, in any order, with a quoted or bare value', () => {
    const [a, b] = parseDynamicTokens(
      'Yes: {{reactions sourcePost="Raid Signup" emoji=👍 show=mainNames}} and {{reactions show=number emoji=👍 sourcePost=Roster}}',
    );
    assert.deepEqual(
      [a.ref, a.label, a.emoji, a.format],
      ['name:raid signup', 'Raid Signup', '👍', 'mainNames'],
    );
    assert.deepEqual([b.ref, b.format], ['name:roster', 'number']);
  });

  it('points at the post itself when post is left out', () => {
    const [self] = parseDynamicTokens('{{ reactions emoji=🔥 show=tags }}');
    assert.deepEqual([self.ref, self.format], ['self', 'tags']);
  });

  it('points at a Discord message by its id (a message the bot posted)', () => {
    const [token] = parseDynamicTokens('{{reactions sourcePost=900000000000000001 emoji=👍}}');
    assert.equal(token.ref, 'msgid:900000000000000001');
    assert.equal(token.message, undefined);
  });

  it('points at any Discord message by its link', () => {
    for (const host of ['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com']) {
      const link = `https://${host}/channels/100000000000000001/800000000000000002/900000000000000003`;
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

  it('shows names unless told otherwise, and accepts any letter case for the format', () => {
    assert.equal(parseDynamicTokens('{{reactions emoji=👍}}')[0].format, 'names');
    assert.equal(
      parseDynamicTokens('{{reactions emoji=👍 show=MAINNAMES}}')[0].format,
      'mainNames',
    );
  });

  it('takes custom emoji, and keeps the tags in text order', () => {
    const tokens = parseDynamicTokens(
      `{{reactions sourcePost="${POST}" emoji=👍 show=names}} then {{reactions sourcePost=A emoji=<:raid:123456789012345678> show=number}}`,
    );
    assert.deepEqual(
      tokens.map((t) => t.emoji),
      ['👍', 'raid:123456789012345678'],
    );
    const reversed = parseDynamicTokens(
      `{{reactions sourcePost=A emoji=🔥}} then {{reactions sourcePost="${POST}" emoji=👍 show=names}}`,
    );
    assert.deepEqual(
      reversed.map((t) => t.emoji),
      ['🔥', '👍'],
    );
  });

  it('refuses tags written wrongly, with a hint', () => {
    for (const bad of [
      '{{reactions sourcePost="A"}}',
      '{{reactions emoji=abc}}',
      '{{reactions emoji=👍 show="unclosed}}',
      '{{reactions emoji=👍',
      '{{reactions emoji=👍 show=}}',
      '{{reactions emoji=👍 colour=red}}',
      '{{reactions emoji=👍 emoji=🔥}}',
      '{{reactions emoji=👍 stray}}',
    ]) {
      assert.throws(() => parseDynamicTokens(bad), BadRequestException, bad);
    }
  });

  it('reads an expression with quotes, backticks, ${…} and }} inside', () => {
    const expression =
      "`${reactions.length}: ${reactions.map((a) => `${a.tag} is ${a.mainName}`).join(', ')}`";
    const text = `Going {{reactions sourcePost="Raid" emoji=👍 show="${expression}"}} and more {{reactions emoji=🔥}}`;
    const tokens = parseDynamicTokens(text);
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0].format, 'custom');
    assert.equal(tokens[0].expression, expression);
    assert.equal(tokens[0].raw, `{{reactions sourcePost="Raid" emoji=👍 show="${expression}"}}`);
    assert.equal(tokens[1].emoji, '🔥');
  });

  it('lets \\" stand for a double quote inside the expression', () => {
    const [token] = parseDynamicTokens('{{reactions emoji=👍 show="\\"a\\" + reactions.length"}}');
    assert.equal(token.expression, '"a" + reactions.length');
  });

  it('no longer accepts the old post= option', () => {
    assert.throws(
      () => parseDynamicTokens('{{reactions post="Raid" emoji=👍}}'),
      /"post", which is not an option here/,
    );
  });

  it('leaves other double-brace text alone', () => {
    assert.deepEqual(parseDynamicTokens('{{something else}} {{reactionsfoo}}'), []);
  });
});

describe('formatReactors', () => {
  it('writes a number, names, or Discord mentions', () => {
    assert.equal(formatReactors('number', [ana, bruno]), '2');
    assert.equal(formatReactors('names', [ana, bruno]), 'Ana, Bruno');
    assert.equal(
      formatReactors('tags', [ana, bruno]),
      '<@100000000000000001>, <@100000000000000002>',
    );
  });

  it('writes main character names like names', () => {
    assert.equal(formatReactors('mainNames', [ana, bruno]), 'Ana, Bruno');
    assert.equal(formatReactors('mainNames', []), 'nobody yet');
  });

  it('says nobody yet for an empty list, but 0 for a number', () => {
    assert.equal(formatReactors('names', []), 'nobody yet');
    assert.equal(formatReactors('number', []), '0');
  });

  it('shortens long lists', () => {
    assert.equal(formatReactors('names', [ana, bruno], 1), 'Ana …and 1 more');
  });
});

describe('renderContent', () => {
  const [token] = parseDynamicTokens(`{{reactions sourcePost="${POST}" emoji=👍 show=names}}`);

  it('replaces every occurrence of the tag with the people', async () => {
    const text = `Yes: ${token.raw}\nAgain: ${token.raw}`;
    const people = new Map([[trackingKey(token), [ana, bruno]]]);
    assert.equal(await renderContent(text, [token], people), 'Yes: Ana, Bruno\nAgain: Ana, Bruno');
  });

  it('reads as nobody when the people are unknown', async () => {
    assert.equal(await renderContent(token.raw, [token], new Map()), 'nobody yet');
  });

  it('leaves text without tags alone', async () => {
    assert.equal(await renderContent('Hello', [], new Map()), 'Hello');
  });

  it('shortens the list until the message fits in Discord', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: String(100000000000000000 + i),
      name: 'x'.repeat(40),
    }));
    const text = `${'a'.repeat(1500)} ${token.raw}`;
    const out = await renderContent(text, [token], new Map([[trackingKey(token), many]]));
    assert.ok(out.length <= 2000);
    assert.match(out, /…and \d+ more/);
  });
});

describe('hashReactors', () => {
  it('is the same for the same people in any order, and changes when someone joins or renames', () => {
    assert.equal(hashReactors([ana, bruno]), hashReactors([bruno, ana]));
    assert.notEqual(hashReactors([ana]), hashReactors([ana, bruno]));
    assert.notEqual(hashReactors([ana]), hashReactors([{ ...ana, name: 'Anna' }]));
  });
});
