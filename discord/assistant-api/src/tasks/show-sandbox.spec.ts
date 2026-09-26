import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  checkExpressions,
  parseDynamicTokens,
  renderContent,
  trackingKey,
  type Reactor,
} from './dynamic-content';
import { checkShowExpression, runShowExpression, ShowExpressionError } from './show-sandbox';

const people = [
  {
    id: '1',
    tag: '<@1>',
    name: 'Ana',
    displayName: 'Ana (Dev)',
    characters: [
      {
        name: 'Merric Stone',
        firstName: 'Merric',
        lastName: 'Stone',
        isMain: true,
        class: 'Warrior',
        roles: ['Tank'],
        level: 60,
      },
      {
        name: 'Olga',
        firstName: 'Olga',
        lastName: '',
        isMain: false,
        class: 'Priest',
        roles: ['Healer'],
        level: 58,
      },
    ],
  },
  { id: '2', tag: '<@2>', name: 'Bruno', displayName: 'Bruno', characters: [] },
];

describe('runShowExpression', () => {
  it('runs the example from the docs: a count, then who is who', async () => {
    const text = await runShowExpression(
      '`${reactions.length}: ${reactions.map((a) => `${a.tag} is ${a.name}`)}`',
      people,
    );
    assert.equal(text, '2: <@1> is Ana,<@2> is Bruno');
  });

  it('gives the characters, with class, roles and whether they are the main', async () => {
    const text = await runShowExpression(
      "reactions.flatMap(r => r.characters.filter(c => c.roles.includes('Tank')).map(c => `${c.name} (${c.class})`))",
      people,
    );
    assert.equal(text, 'Merric Stone (Warrior)');
    assert.equal(
      await runShowExpression(
        'reactions.map(r => (r.characters.find(c => c.isMain) || {}).name || r.name)',
        people,
      ),
      'Merric Stone, Bruno',
    );
  });

  it('gives each person their server nickname as displayName', async () => {
    assert.equal(
      await runShowExpression('reactions.map(r => r.displayName)', people),
      'Ana (Dev), Bruno',
    );
  });

  it('joins an array result with commas, and turns other results into text', async () => {
    assert.equal(await runShowExpression('reactions.map(r => r.name)', people), 'Ana, Bruno');
    assert.equal(await runShowExpression('reactions.length', people), '2');
    assert.equal(await runShowExpression('reactions.length > 5 ? "many" : "few"', people), 'few');
  });

  it('works with no people at all', async () => {
    assert.equal(await runShowExpression('reactions.length', []), '0');
  });

  it('cannot reach anything outside the language', async () => {
    const text = await runShowExpression(
      '[typeof process, typeof require, typeof fetch, typeof globalThis.process, typeof Buffer].join(" ")',
      people,
    );
    assert.equal(text, 'undefined undefined undefined undefined undefined');
  });

  it('cannot change what other tags see: every run starts fresh', async () => {
    await runShowExpression('(globalThis.leak = 1, "x")', people);
    assert.equal(await runShowExpression('typeof globalThis.leak', people), 'undefined');
  });

  it('is stopped when it never ends', async () => {
    await assert.rejects(
      runShowExpression('(() => { while (true) {} })()', people),
      (error: Error) => error instanceof ShowExpressionError && /took too long/.test(error.message),
    );
  });

  it('is stopped when it eats memory', async () => {
    await assert.rejects(
      runShowExpression('(() => { const a = []; for (;;) a.push("x".repeat(1e6)); })()', people),
      ShowExpressionError,
    );
  });

  it('reports errors of the expression as ShowExpressionError', async () => {
    await assert.rejects(runShowExpression('reactions.foo.bar', people), /TypeError/);
    await assert.rejects(runShowExpression('nope', people), /ReferenceError/);
    await assert.rejects(runShowExpression('reactions.map(', people), /SyntaxError/);
  });

  it('cannot break out of the wrapper to run something else', async () => {
    await assert.rejects(runShowExpression('1); process.exit(1); (2', people), ShowExpressionError);
  });
});

describe('checking expressions on save', () => {
  it('accepts a working expression and refuses a broken one with the reason', async () => {
    await checkShowExpression('reactions.map(r => r.name)');
    const [bad] = parseDynamicTokens('{{reactions emoji=👍 show="reactions.map("}}');
    await assert.rejects(checkExpressions([bad]), (error: Error) => {
      return error instanceof BadRequestException && /SyntaxError/.test(error.message);
    });
  });

  it('refuses an unknown name: a bare word is an expression, not a keyword', async () => {
    const [bad] = parseDynamicTokens('{{reactions emoji=👍 show=people}}');
    await assert.rejects(checkExpressions([bad]), /ReferenceError/);
  });

  it('accepts the default expression', async () => {
    await checkExpressions(
      parseDynamicTokens('{{reactions emoji=👍 show="reactions.map(r => r.name)"}}'),
    );
  });
});

describe('an expression in a post', () => {
  it('is replaced by what it returns, and a failing one is shown as a warning, not a broken post', async () => {
    const text =
      'Going: {{reactions sourcePost="A" emoji=👍 show="`${reactions.length}: ${reactions.map(a => a.name)}`"}} / {{reactions sourcePost="A" emoji=👍 show="reactions.x.y"}}';
    const tokens = parseDynamicTokens(text);
    const ana: Reactor = { id: '1', name: 'Ana' };
    const map = new Map([[trackingKey(tokens[0]), [ana]]]);
    const out = await renderContent(text, tokens, map);
    assert.match(out, /^Going: 1: Ana \/ ⚠️ \(TypeError/);
  });
});
