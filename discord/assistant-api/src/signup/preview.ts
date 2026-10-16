/**
 * Renders the sign-up feature's Discord messages from sample data and prints them as JSON, to
 * paste into Discohook (https://discohook.org → JSON Data Editor) and see them as Discord would.
 * No database, no Discord: only the same pure functions the bot uses (signup-messages.ts).
 *
 *   npm run signup:preview                      the sign-up post of a 25-person raid
 *   npm run signup:preview -- setup             its raid setup
 *   npm run signup:preview -- assignment        one assignment
 *   npm run signup:preview -- event members     a members event (also: setup members)
 *
 * The class icons and raid markers are emojis of our bot, which Discohook can't show: they print
 * as coloured squares / marker names instead.
 */
import type { Role, SignupStatus } from '@prisma/client';
import { EVENT_KINDS } from './event-kinds';
import {
  renderAssignmentMessage,
  renderEventMessage,
  renderSetupMessage,
  type EntryView,
  type EventView,
} from './signup-messages';

/** Stand-ins for the class icons: the nearest coloured square. */
const CLASS_SQUARES: Record<string, string> = {
  Druid: '🟧',
  Hunter: '🟩',
  Mage: '🟦',
  Paladin: '🩷',
  Priest: '⬜',
  Rogue: '🟨',
  Shaman: '🔷',
  Warlock: '🟪',
  Warrior: '🟫',
};
const dot = (className: string | null) => (className ? (CLASS_SQUARES[className] ?? '') : '');

const SAMPLE: [string, string, Role, SignupStatus][] = [
  ['Blitzrn', 'Warrior', 'TANK', 'AVAILABLE'],
  ['Feirlane', 'Druid', 'TANK', 'AVAILABLE'],
  ['Clayr', 'Hunter', 'RANGED_DPS', 'AVAILABLE'],
  ['Bladebaron', 'Shaman', 'HEALER', 'AVAILABLE'],
  ['Yaxx', 'Priest', 'HEALER', 'AVAILABLE'],
  ['Who', 'Warrior', 'MELEE_DPS', 'AVAILABLE'],
  ['Aring', 'Rogue', 'MELEE_DPS', 'AVAILABLE'],
  ['Crimsonwound', 'Shaman', 'HEALER', 'AVAILABLE'],
  ['Drahcia', 'Mage', 'RANGED_DPS', 'AVAILABLE'],
  ['Feral', 'Druid', 'MELEE_DPS', 'AVAILABLE'],
  ['Abbhee', 'Warlock', 'RANGED_DPS', 'AVAILABLE'],
  ['Topiaa', 'Druid', 'HEALER', 'AVAILABLE'],
  ['Sketcho', 'Priest', 'HEALER', 'AVAILABLE'],
  ['Sageman', 'Warlock', 'RANGED_DPS', 'AVAILABLE'],
  ['Seekuhlol', 'Mage', 'RANGED_DPS', 'AVAILABLE'],
  ['Bumfiddler', 'Shaman', 'HEALER', 'AVAILABLE'],
  ['Darkshivan', 'Paladin', 'TANK', 'TENTATIVE'],
  ['Sorrway', 'Rogue', 'MELEE_DPS', 'ABSENT'],
  ['Wuffelguffel', 'Priest', 'HEALER', 'AVAILABLE'],
  ['Abazagorat', 'Paladin', 'HEALER', 'AVAILABLE'],
  ['Gammorha', 'Paladin', 'MELEE_DPS', 'LATE'],
  ['Cutiez', 'Shaman', 'RANGED_DPS', 'AVAILABLE'],
  ['Hafren', 'Druid', 'RANGED_DPS', 'AVAILABLE'],
  ['Shouri', 'Mage', 'RANGED_DPS', 'ABSENT'],
  ['Xihm', 'Shaman', 'HEALER', 'TENTATIVE'],
  ['Whiteshamy', 'Shaman', 'HEALER', 'AVAILABLE'],
  ['Pixies', 'Hunter', 'RANGED_DPS', 'AVAILABLE'],
];

function entries(members: boolean): EntryView[] {
  let placed = 0;
  return SAMPLE.map(([name, characterClass, role, status], index) => {
    // The first 20 who are coming sit in groups of five (or are invited, for members).
    const inGroup = status !== 'ABSENT' && placed < 20;
    const slot = inGroup ? placed++ : null;
    return {
      id: `entry-${index}`,
      // As a string: Discord ids are too big for a JavaScript number.
      discordUserId: `1000000000000000${String(index).padStart(2, '0')}`,
      discordName: name,
      characterName: members ? null : name,
      characterClass: members ? null : characterClass,
      role: members ? null : role,
      status,
      groupNumber: slot === null ? null : members ? 1 : Math.floor(slot / 5) + 1,
      groupSlot: slot === null ? null : members ? slot : slot % 5,
    };
  });
}

function main(): void {
  const [which = 'event', kindArg] = process.argv.slice(2);
  const members = kindArg === 'members' || which === 'members';
  const event: EventView = {
    id: '0b6f3c2e-5d4a-4f1b-9c8d-7e6f5a4b3c2d',
    title: members ? 'Social night at the inn' : 'Black Temple',
    description: members ? 'Drinks, music and bad dancing.' : '3SR. Bring flasks and pots.',
    startsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
    closed: false,
    createdByName: 'Blitzrn',
    kind: members ? EVENT_KINDS.MEMBERS : EVENT_KINDS.CHARACTERS,
    eventUrl: 'https://guildassistant.app/example/event',
    addCharacterUrl: 'https://guildassistant.app/example/roster/create',
  };
  const people = entries(members);

  let message;
  if (which === 'setup') {
    message = renderSetupMessage(event, people, false, { dot });
  } else if (which === 'assignment') {
    message = renderAssignmentMessage(
      {
        scope: 'BOSS',
        scopeLabel: 'Illidan Stormrage',
        title: 'Tanks and healers',
        mentions: true,
        lines: [
          {
            entryIds: ['entry-0'],
            task: 'tanks Illidan on',
            target: { kind: 'marker', marker: 'SKULL' },
          },
          {
            entryIds: ['entry-1'],
            task: 'picks up the flames on',
            target: { kind: 'marker', marker: 'CROSS' },
          },
          {
            entryIds: ['entry-4', 'entry-12'],
            task: 'heal',
            target: { kind: 'player', entryId: 'entry-0' },
          },
          {
            entryIds: ['entry-10'],
            task: 'moves out with the Parasitic Shadowfiend',
            target: null,
          },
        ],
      },
      people,
      (marker) => `:${marker.toLowerCase()}:`,
    );
  } else {
    message = renderEventMessage(event, people, { dot });
  }

  // Discohook's JSON editor takes the message itself: content, embeds and components.
  const { content, embeds, components } = message;
  console.log(
    JSON.stringify(
      { content: content ?? '', embeds: embeds ?? [], components: components ?? [] },
      null,
      2,
    ),
  );
}

if (require.main === module) main();
