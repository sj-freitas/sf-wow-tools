import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';

/** One character of a person who reacted, in the guild. */
export interface ShowCharacter {
  /** `Name` or `Name Lastname`, as shown in the roster. */
  name: string;
  firstName: string;
  /** Empty when the character has no last name. */
  lastName: string;
  isMain: boolean;
  /** The class, like "Warrior". */
  class: string;
  /** Their roles: "Tank", "Healer", "Melee DPS" and/or "Ranged DPS". */
  roles: string[];
  level: number;
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

/** An expression that is written wrongly or fails when it runs. */
export class ShowExpressionError extends Error {}

const TIME_LIMIT_MS = 100;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
const MAX_RESULT_LENGTH = 4000;

/**
 * Evaluates the `show` expression of a tag, e.g. `` `${reactions.length}: ${reactions.map(r => r.name)}` ``,
 * with the people who reacted as `reactions`. The expression is written by whoever edits a post, so
 * it runs in QuickJS (a JavaScript engine compiled to WebAssembly) rather than in Node: it has
 * no access to files, the network, `process`, `require` or anything of ours, only the standard
 * language, and it is stopped after 100 ms and 16 MB. An array result is joined with ", "; anything
 * else is turned into text.
 */
export async function runShowExpression(
  expression: string,
  reactors: readonly ShowReactor[],
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
  const reactions = JSON.parse(${JSON.stringify(JSON.stringify(reactors))});
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

const SAMPLE: ShowReactor[] = [
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
        isMain: true,
        class: 'Warrior',
        roles: ['Tank'],
        level: 60,
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
];

/** Runs an expression once on two made-up people, so a typo is refused on save. */
export async function checkShowExpression(expression: string): Promise<void> {
  await runShowExpression(expression, SAMPLE);
}
