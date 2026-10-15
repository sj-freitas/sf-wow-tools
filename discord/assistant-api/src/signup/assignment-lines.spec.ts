import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entriesIn, parseLines, readLines, remapLines, renderLine } from './assignment-lines';

const ENTRIES = new Set(['dark', 'teary', 'arthas']);
const NAMES: Record<string, string> = { dark: 'Darkshivan', teary: 'Tearyn', arthas: 'Arthas' };
const nameOf = (id: string) => NAMES[id] ?? null;

describe('parseLines', () => {
  it('keeps players, a task and a target, dropping empty lines', () => {
    const lines = parseLines(
      [
        { entryIds: ['dark'], task: ' heals ', target: { kind: 'player', entryId: 'teary' } },
        { entryIds: ['dark', 'dark'], task: 'tanks', target: { kind: 'marker', marker: 'CROSS' } },
        { entryIds: ['arthas'], task: 'moves to the end of the room', target: null },
        { entryIds: [], task: '  ', target: null },
      ],
      ENTRIES,
    );
    assert.deepEqual(lines, [
      { entryIds: ['dark'], task: 'heals', target: { kind: 'player', entryId: 'teary' } },
      { entryIds: ['dark'], task: 'tanks', target: { kind: 'marker', marker: 'CROSS' } },
      { entryIds: ['arthas'], task: 'moves to the end of the room', target: null },
    ]);
  });

  it('refuses players who are not signed up and unknown targets', () => {
    assert.match(parseLines([{ entryIds: ['ghost'], task: 'x' }], ENTRIES) as string, /no longer/);
    assert.match(
      parseLines(
        [{ entryIds: ['dark'], task: 'x', target: { kind: 'marker', marker: 'X' } }],
        ENTRIES,
      ) as string,
      /raid marker or a player/,
    );
    assert.match(parseLines('nope', ENTRIES) as string, /no lines/);
  });
});

describe('renderLine', () => {
  it('writes players, the task and the target', () => {
    assert.equal(
      renderLine(
        { entryIds: ['dark'], task: 'heals', target: { kind: 'player', entryId: 'teary' } },
        nameOf,
      ),
      '• **Darkshivan** heals **Tearyn**',
    );
    assert.equal(
      renderLine(
        { entryIds: ['dark', 'arthas'], task: 'tank', target: { kind: 'marker', marker: 'SKULL' } },
        nameOf,
      ),
      '• **Darkshivan**, **Arthas** tank [Skull]',
    );
  });

  it('shows a marker as its emoji when there is one, else as text', () => {
    const line = {
      entryIds: ['dark'],
      task: 'tanks',
      target: { kind: 'marker' as const, marker: 'SKULL' as const },
    };
    const emoji = (marker: string) => (marker === 'Skull' ? '<:m_skull_1:9>' : '');
    assert.equal(renderLine(line, nameOf, emoji), '• **Darkshivan** tanks <:m_skull_1:9>');
    assert.equal(
      renderLine({ ...line, target: { kind: 'marker', marker: 'CIRCLE' } }, nameOf, emoji),
      '• **Darkshivan** tanks [Circle]',
    );
  });

  it('leaves out people who left, and says nothing when nothing is left', () => {
    assert.equal(
      renderLine({ entryIds: ['ghost', 'dark'], task: 'stacks', target: null }, nameOf),
      '• **Darkshivan** stacks',
    );
    assert.equal(renderLine({ entryIds: ['ghost'], task: '', target: null }, nameOf), null);
  });
});

describe('readLines / entriesIn', () => {
  it('reads stored lines leniently and lists everyone they mention', () => {
    const lines = readLines([
      { entryIds: ['dark', 3], task: 'heals', target: { kind: 'player', entryId: 'teary' } },
      'garbage',
      { entryIds: ['arthas'], task: 'kites', target: { kind: 'bogus' } },
    ]);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].target, null);
    assert.deepEqual(entriesIn(lines), ['dark', 'teary', 'arthas']);
  });
});

describe('remapLines', () => {
  const map: Record<string, string> = { dark: 'dark2', teary: 'teary2' };
  const mapEntry = (id: string) => map[id] ?? null;

  it('points players and target players at their sign-ups in the new event', () => {
    assert.deepEqual(
      remapLines(
        [{ entryIds: ['dark'], task: 'heals', target: { kind: 'player', entryId: 'teary' } }],
        mapEntry,
      ),
      {
        lines: [
          { entryIds: ['dark2'], task: 'heals', target: { kind: 'player', entryId: 'teary2' } },
        ],
        dropped: 0,
      },
    );
  });

  it('drops people not signed up, a target that went, and lines left empty', () => {
    const { lines, dropped } = remapLines(
      [
        { entryIds: ['dark', 'ghost'], task: 'tanks', target: { kind: 'marker', marker: 'SKULL' } },
        { entryIds: ['dark'], task: 'heals', target: { kind: 'player', entryId: 'ghost' } },
        { entryIds: ['ghost'], task: '', target: null },
        { entryIds: [], task: 'everyone stacks', target: null },
      ],
      mapEntry,
    );
    assert.deepEqual(lines, [
      { entryIds: ['dark2'], task: 'tanks', target: { kind: 'marker', marker: 'SKULL' } },
      { entryIds: ['dark2'], task: 'heals', target: null },
      { entryIds: [], task: 'everyone stacks', target: null },
    ]);
    assert.equal(dropped, 3);
  });
});
