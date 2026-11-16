import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

/** One character of a person who reacted, in the guild. */
export interface ShowCharacter {
  /** `Name` or `Name Lastname`, as shown in the roster. */
  name: string;
  firstName: string;
  /** Empty when the character has no last name. */
  lastName: string;
  /** The names of the guild attributes it has ("Main", "Switcher", …), A–Z; empty when none. */
  attributes: string[];
  /** The class, like "Warrior". */
  class: string;
  /** The race, like "Human"; empty when unknown (added before this was collected, or from Discord). */
  race: string;
  /** Their roles: "Tank", "Healer", "Melee DPS" and/or "Ranged DPS". */
  roles: string[];
  level: number;
  /** The class's icon as Discord emoji text, ready to put in a post; '' when unavailable. */
  classIcon: string;
  /** Each role's icon the same way, in the order of `roles`. */
  roleIcons: string[];
}

/** What an expression sees of each person who reacted (`reactions[i]`). */
export interface ShowReactor {
  /** Discord user id. */
  id: string;
  /** A mention: `<@id>`. */
  tag: string;
  /** Discord display name (their global name, or username). */
  name: string;
  /** How they are shown in the message's server: their nickname there, else `name`. */
  displayName: string;
  /** Their characters in the guild (empty when they have none), main first. */
  characters: ShowCharacter[];
}

/** The Discord user who plays a character of the roster. */
export interface ShowDiscordUser {
  /** Discord user id. */
  id: string;
  /** A mention: `<@id>`. */
  tag: string;
  /** Their Discord name (global display name, else username; the id when it is not known). */
  name: string;
  /** How they are shown in the guild's main server: their nickname there, else `name`. */
  displayName: string;
  /** The names of the Discord roles they hold in the guild's main server. */
  roles: string[];
}

/** One character of the guild's roster (`roster[i]`), with the Discord user who plays it. */
export interface ShowRosterEntry extends ShowCharacter {
  discordUser: ShowDiscordUser;
  /** The character's page in the armory (the version's `armoryLink`); null when it has none. */
  armoryLink: string | null;
}

/** The name an expression uses for its list: `reactions` in a reactions tag, `roster` in a roster tag. */
export type ShowVariable = 'reactions' | 'roster';

/** An expression that is written wrongly or fails when it runs. */
export class ShowExpressionError extends Error {}

const TIME_LIMIT_MS = 100;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
const MAX_RESULT_LENGTH = 4000;

/**
 * Evaluates the `show` expression of a tag, e.g. `` `${reactions.length}: ${reactions.map(r => r.name)}` ``,
 * with the people who reacted as `reactions` (or the guild's characters as `roster`). The expression is written by whoever edits a post, so
 * it runs in QuickJS (a JavaScript engine compiled to WebAssembly) rather than in Node: it has
 * no access to files, the network, `process`, `require` or anything of ours, only the standard
 * language, and it is stopped after 100 ms and 16 MB. An array result is joined with ", "; anything
 * else is turned into text.
 */
export async function runShowExpression(
  expression: string,
  data: readonly (ShowReactor | ShowRosterEntry)[],
  variable: ShowVariable = 'reactions',
): Promise<string> {
  const quickJS = await getQuickJS();
  const runtime = quickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(STACK_LIMIT_BYTES);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIME_LIMIT_MS));
  const context = runtime.newContext();
  try {
    // The people are handed over as JSON text: plain data, nothing that reaches back into Node.
    const program = `"use strict";
(function () {
  const ${variable} = JSON.parse(${JSON.stringify(JSON.stringify(data))});
  const result = (
${expression}
  );
  return Array.isArray(result) ? result.join(', ') : String(result);
})()`;
    const outcome = context.evalCode(program, 'show.js');
    if (outcome.error) {
      const error = context.dump(outcome.error) as { name?: string; message?: string };
      outcome.error.dispose();
      throw new ShowExpressionError(
        error.name === 'InternalError' && error.message === 'interrupted'
          ? 'took too long to run'
          : `${error.name ?? 'Error'}: ${error.message ?? 'failed'}`,
      );
    }
    const text = String(context.dump(outcome.value));
    outcome.value.dispose();
    return text.length > MAX_RESULT_LENGTH ? `${text.slice(0, MAX_RESULT_LENGTH)}…` : text;
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

/**
 * The made-up people every reactions expression is tried on: when a post is saved (so a typo is
 * refused), and in the backoffice's preview (real reactions are never read for a preview, because
 * the post they belong to usually has not been sent yet). Between them they cover what expressions
 * trip over: somebody with no character at all, somebody with a main and an alt, every role, a
 * character with two roles, and one whose race was never collected.
 */
export const SAMPLE_REACTORS: ShowReactor[] = [
  {
    id: '100000000000000001',
    tag: '<@100000000000000001>',
    name: 'Ana',
    displayName: 'Ana (Dev)',
    characters: [
      {
        name: 'Merric Stone',
        firstName: 'Merric',
        lastName: 'Stone',
        attributes: ['Main', 'Switcher'],
        class: 'Warrior',
        race: 'Human',
        roles: ['Tank'],
        level: 60,
        classIcon: '<:i_warrior_92c497bf:100000000000000101>',
        roleIcons: ['<:r_tank_24531a51:100000000000000102>'],
      },
      {
        name: 'Anabank',
        firstName: 'Anabank',
        lastName: '',
        attributes: [],
        class: 'Mage',
        race: 'Gnome',
        roles: ['Ranged DPS'],
        level: 31,
        classIcon: '<:i_mage_1f0a7c24:100000000000000105>',
        roleIcons: ['<:r_rangeddps_7b1d9e60:100000000000000106>'],
      },
    ],
  },
  {
    id: '100000000000000002',
    tag: '<@100000000000000002>',
    name: 'Bruno',
    displayName: 'Bruno',
    characters: [],
  },
  {
    id: '100000000000000003',
    tag: '<@100000000000000003>',
    name: 'Cora',
    displayName: 'Cora',
    characters: [
      {
        name: 'Coraleaf Whisperwind',
        firstName: 'Coraleaf',
        lastName: 'Whisperwind',
        attributes: ['Main'],
        class: 'Druid',
        // Added before races were collected: an expression has to cope with an empty race.
        race: '',
        roles: ['Healer'],
        level: 60,
        classIcon: '<:i_druid_3c5f8a11:100000000000000107>',
        roleIcons: ['<:r_healer_4c342222:100000000000000104>'],
      },
    ],
  },
  {
    id: '100000000000000004',
    tag: '<@100000000000000004>',
    name: 'Dilip',
    displayName: 'Dilip (he/him)',
    characters: [
      {
        name: 'Dilipstab',
        firstName: 'Dilipstab',
        lastName: '',
        attributes: ['Main'],
        class: 'Rogue',
        race: 'Night Elf',
        roles: ['Melee DPS'],
        level: 60,
        classIcon: '<:i_rogue_55b2e0d9:100000000000000108>',
        roleIcons: ['<:r_meleedps_2a90f3c7:100000000000000109>'],
      },
    ],
  },
  {
    id: '100000000000000005',
    tag: '<@100000000000000005>',
    name: 'Eve',
    displayName: 'Eve',
    characters: [
      {
        name: 'Evecaster',
        firstName: 'Evecaster',
        lastName: '',
        attributes: ['Main'],
        class: 'Mage',
        race: 'Human',
        roles: ['Ranged DPS'],
        level: 58,
        classIcon: '<:i_mage_1f0a7c24:100000000000000105>',
        roleIcons: ['<:r_rangeddps_7b1d9e60:100000000000000106>'],
      },
    ],
  },
  {
    id: '100000000000000006',
    tag: '<@100000000000000006>',
    name: 'Faruk',
    displayName: 'Faruk',
    characters: [
      {
        name: 'Farukshield',
        firstName: 'Farukshield',
        lastName: '',
        attributes: ['Main'],
        class: 'Paladin',
        race: 'Dwarf',
        // Two roles: roleIcons follows the same order.
        roles: ['Tank', 'Healer'],
        level: 60,
        classIcon: '<:i_paladin_6d31b4a8:100000000000000110>',
        roleIcons: [
          '<:r_tank_24531a51:100000000000000102>',
          '<:r_healer_4c342222:100000000000000104>',
        ],
      },
    ],
  },
];

const SAMPLE_ROSTER: ShowRosterEntry[] = [
  {
    ...SAMPLE_REACTORS[0].characters[0],
    armoryLink: 'https://armory.example/character/eu/pve/merric',
    discordUser: {
      id: SAMPLE_REACTORS[0].id,
      tag: SAMPLE_REACTORS[0].tag,
      name: SAMPLE_REACTORS[0].name,
      displayName: SAMPLE_REACTORS[0].displayName,
      roles: ['Officer', 'Raider'],
    },
  },
  {
    name: 'Olga',
    firstName: 'Olga',
    lastName: '',
    attributes: [],
    class: 'Priest',
    race: 'Human',
    roles: ['Healer'],
    level: 58,
    classIcon: '<:i_priest_6f827548:100000000000000103>',
    roleIcons: ['<:r_healer_4c342222:100000000000000104>'],
    armoryLink: 'https://armory.example/character/eu/pve/olga',
    discordUser: {
      id: SAMPLE_REACTORS[1].id,
      tag: SAMPLE_REACTORS[1].tag,
      name: SAMPLE_REACTORS[1].name,
      displayName: SAMPLE_REACTORS[1].displayName,
      roles: [],
    },
  },
];

/** Runs an expression once on made-up people or characters, so a typo is refused on save. */
export async function checkShowExpression(
  expression: string,
  variable: ShowVariable = 'reactions',
): Promise<void> {
  await runShowExpression(
    expression,
    variable === 'roster' ? SAMPLE_ROSTER : SAMPLE_REACTORS,
    variable,
  );
}
