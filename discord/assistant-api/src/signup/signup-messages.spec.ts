import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  nameList,
  renderAssignmentMessage,
  renderEventMessage,
  renderSetupMessage,
  type EntryView,
  type EventView,
} from './signup-messages';

const EVENT: EventView = {
  id: '0b6f3c2e-5d4a-4f1b-9c8d-7e6f5a4b3c2d',
  title: 'Naxxramas',
  description: 'Bring flasks.',
  startsAt: new Date('2026-10-20T18:00:00Z'),
  closed: false,
  createdByName: 'Shivan',
  eventUrl: 'https://example.test/e',
  addCharacterUrl: 'https://example.test/add',
};

const entry = (over: Partial<EntryView> & { id: string }): EntryView => ({
  discordUserId: `u-${over.id}`,
  discordName: `Discord ${over.id}`,
  characterName: `Char ${over.id}`,
  characterClass: 'Priest',
  role: 'HEALER',
  status: 'AVAILABLE',
  groupNumber: null,
  groupSlot: null,
  ...over,
});

interface Field {
  name: string;
  value: string;
}
interface Button {
  disabled?: boolean;
  url?: string;
  label: string;
}
const fieldsOf = (message: ReturnType<typeof renderEventMessage>) =>
  (message.embeds?.[0].fields ?? []) as Field[];
const buttonsOf = (message: ReturnType<typeof renderEventMessage>) =>
  (message.components as { components: Button[] }[]).flatMap((row) => row.components);

describe('renderEventMessage', () => {
  it('lists people in role columns with their sign-up number and class colour', () => {
    const dot = (className: string | null) => (className === 'Warrior' ? '<:c_warrior:1>' : '');
    const message = renderEventMessage(
      EVENT,
      [
        entry({ id: 'a', characterName: 'Darkshivan', role: 'TANK', characterClass: 'Warrior' }),
        entry({ id: 'b', characterName: 'Tearyn' }),
        entry({ id: 'c', characterName: 'Late Guy', status: 'LATE', role: 'RANGED_DPS' }),
        entry({ id: 'd', characterName: null, status: 'ABSENT', role: null }),
        entry({ id: 'e', characterName: 'Maybe', status: 'TENTATIVE' }),
        entry({ id: 'f', characterName: 'Aaron', role: 'TANK', characterClass: 'Warrior' }),
      ],
      dot,
    );
    const fields = fieldsOf(message);
    // Two role columns per row (an empty cell keeps them aligned), then the other answers.
    assert.deepEqual(
      fields.map((field) => field.name),
      [
        '🛡️ Tank (2)',
        '💚 Healer (1)',
        '\u200b',
        '🏹 Ranged (0)',
        '⚔️ Melee (0)',
        '\u200b',
        '⏰ Late (1)',
        '❔ Tentative (1)',
        '❌ Absent (1)',
      ],
    );
    // Numbered in sign-up order, one per line, no class names.
    assert.equal(
      fields[0].value,
      '`1` <:c_warrior:1> **Darkshivan**\n`6` <:c_warrior:1> **Aaron**',
    );
    assert.equal(fields[1].value, '`2` **Tearyn**');
    assert.equal(fields[3].value, '—');
    assert.equal(fields[6].value, '`3` **Late Guy**');
    assert.equal(fields[8].value, '`4` **Discord d**');
  });

  it('shows the leader, the time, and how many are coming (+ tentative)', () => {
    const message = renderEventMessage(EVENT, [
      entry({ id: 'a' }),
      entry({ id: 'b', status: 'LATE' }),
      entry({ id: 'c', status: 'TENTATIVE' }),
      entry({ id: 'd', status: 'ABSENT' }),
    ]);
    const description = message.embeds?.[0].description ?? '';
    assert.match(description, /^Bring flasks\.\n\n🗓️ <t:\d+:F> · ⏳ <t:\d+:R>/);
    assert.match(description, /👑 Shivan · 👥 \*\*2\*\* \(\+1\)$/);
    assert.equal(message.embeds?.[0].footer, undefined);
  });

  it('disables the answer buttons once closed, but not the links', () => {
    const buttons = buttonsOf(renderEventMessage({ ...EVENT, closed: true }, []));
    assert.deepEqual(
      buttons.filter((button) => button.disabled).map((button) => button.label),
      ['Sign up', 'Late', 'Tentative', 'Absent'],
    );
    assert.ok(buttons.some((button) => button.url === EVENT.addCharacterUrl));
    assert.match(
      renderEventMessage({ ...EVENT, closed: true }, []).embeds?.[0].footer?.text ?? '',
      /closed/,
    );
  });
});

describe('nameList', () => {
  it('joins with the separator given', () => {
    assert.equal(nameList(['a', 'b'], 100, ', '), 'a, b');
    assert.equal(nameList([]), '—');
  });

  it('cuts long lists short within the limit', () => {
    const list = nameList(
      Array.from({ length: 100 }, (_, i) => `Character number ${i}`),
      200,
    );
    assert.ok(list.length <= 200);
    assert.match(list, /\+\d+ more$/);
  });
});

describe('renderSetupMessage', () => {
  const entries = [
    entry({ id: 'a', groupNumber: 2, groupSlot: 1, characterName: 'Second' }),
    entry({ id: 'b', groupNumber: 2, groupSlot: 0, characterName: 'First', role: 'TANK' }),
    entry({ id: 'c' }),
  ];

  it('shows the groups in order and leaves the bench out', () => {
    const message = renderSetupMessage(EVENT, entries, false);
    const fields = (message.embeds?.[0].fields ?? []) as Field[];
    assert.deepEqual(fields, [{ name: 'Group 2', value: '🛡️ – First\n💚 – Second', inline: true }]);
    assert.equal(message.content, '');
    assert.equal(message.mention, false);
  });

  it('mentions the placed players when asked', () => {
    const message = renderSetupMessage(EVENT, entries, true);
    assert.equal(message.content, '<@u-b> <@u-a>');
    assert.equal(message.mention, true);
  });
});

describe('renderAssignmentMessage', () => {
  const entries = [
    entry({ id: 'a', characterName: 'Darkshivan' }),
    entry({ id: 'b', characterName: 'Tearyn' }),
  ];
  const assignment = {
    scope: 'BOSS' as const,
    scopeLabel: 'Patchwerk',
    title: 'Healers',
    lines: [{ entryIds: ['a'], task: 'heals', target: { kind: 'player' as const, entryId: 'b' } }],
    mentions: false,
  };

  it('writes the heading and lines', () => {
    const message = renderAssignmentMessage(assignment, entries);
    assert.equal(
      message.content,
      '### Healers\n-# Boss · Patchwerk\n• **Darkshivan** heals **Tearyn**',
    );
    assert.equal(message.mention, false);
  });

  it('mentions the assigned players (not the targets) when its toggle is on', () => {
    const message = renderAssignmentMessage({ ...assignment, mentions: true }, entries);
    assert.match(message.content ?? '', /\n\n<@u-a>$/);
    assert.equal(message.mention, true);
  });
});
