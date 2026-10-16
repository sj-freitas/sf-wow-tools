import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_KINDS } from './event-kinds';
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
  kind: EVENT_KINDS.CHARACTERS,
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
/** Every list field ends with a blank line, for the space between rows. */
const GAP = '\n\u200b';

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
      { dot },
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
      '`1` <:c_warrior:1> **Darkshivan**\n`6` <:c_warrior:1> **Aaron**' + GAP,
    );
    assert.equal(fields[1].value, '`2` **Tearyn**' + GAP);
    assert.equal(fields[3].value, '—' + GAP);
    assert.equal(fields[6].value, '`3` **Late Guy**' + GAP);
    assert.equal(fields[8].value, '`4` **Discord d**' + GAP);
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
    assert.deepEqual(fields, [
      { name: 'Group 2:', value: '🛡️ – First\n💚 – Second' + GAP, inline: true },
    ]);
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

describe('a members event', () => {
  const MEMBERS = { ...EVENT, kind: EVENT_KINDS.MEMBERS };

  it('lists who signed up in one list, by name, and has no Add character link', () => {
    const message = renderEventMessage(MEMBERS, [
      entry({
        id: 'a',
        characterName: null,
        characterClass: null,
        role: null,
        discordName: 'Shivan',
      }),
      entry({ id: 'b', characterName: null, characterClass: null, role: null, status: 'LATE' }),
    ]);
    const fields = fieldsOf(message);
    assert.deepEqual(
      fields.map((field) => field.name),
      ['✅ Signed up (1)', '⏰ Late (1)'],
    );
    assert.equal(fields[0].value, '`1` **Shivan**' + GAP);
    assert.ok(!buttonsOf(message).some((button) => button.label === 'Add character'));
  });

  it('spreads a long list over up to three columns', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      entry({ id: `p${i}`, characterName: null, characterClass: null, role: null }),
    );
    const fields = fieldsOf(renderEventMessage(MEMBERS, many));
    assert.equal(fields.length, 3);
    assert.equal(fields[0].name, '✅ Signed up (20)');
  });

  it('posts the invited (one unlimited group), mentioning them when asked', () => {
    const invited = Array.from({ length: 7 }, (_, i) =>
      entry({ id: `p${i}`, characterName: null, role: null, groupNumber: 1, groupSlot: i }),
    );
    const message = renderSetupMessage(MEMBERS, invited, true);
    assert.equal(message.embeds?.[0].title, 'Invited · Naxxramas');
    assert.equal((message.embeds?.[0].fields as Field[])[0].name, 'Invited (7):');
    assert.equal(message.content?.split(' ').length, 7);
  });
});

describe('role and leader icons', () => {
  it('uses the icons given, falling back to emoji for the ones missing', () => {
    const message = renderEventMessage(EVENT, [entry({ id: 'a', role: 'TANK' })], {
      role: (role) => (role === 'TANK' ? '<:r_tank_1:1>' : ''),
      leader: '<:r_leader_1:2>',
    });
    const names = fieldsOf(message).map((field) => field.name);
    assert.equal(names[0], '<:r_tank_1:1> Tank (1)');
    assert.equal(names[1], '💚 Healer (0)');
    assert.match(message.embeds?.[0].description ?? '', /<:r_leader_1:2> Shivan/);
  });

  it('puts the role icon in front of each person in the groups', () => {
    const message = renderSetupMessage(
      EVENT,
      [entry({ id: 'a', role: 'TANK', groupNumber: 1, groupSlot: 0, characterName: 'Tanky' })],
      false,
      { role: () => '<:r_tank_1:1>' },
    );
    assert.equal(fieldsOf(message)[0].value, '<:r_tank_1:1> – Tanky' + GAP);
  });
});
