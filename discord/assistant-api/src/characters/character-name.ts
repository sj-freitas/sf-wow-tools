export interface CharacterName {
  firstName: string;
  lastName: string;
}

export const MIN_NAME_LETTERS = 2;
export const MAX_NAME_LETTERS = 12;

/** Starts with a letter of any alphabet; combining marks may follow (accents, vowel signs). No digits. */
const NAME_PART = /^\p{L}[\p{L}\p{M}]*$/u;
const LETTER = /\p{L}/u;

/** First letter upper case, the rest lower case, e.g. `aRTHAS` -> `Arthas`. */
function capitalize(part: string): string {
  const [first, ...rest] = [...part];
  return (first.toLocaleUpperCase() + rest.join('').toLocaleLowerCase()).normalize('NFC');
}

/** Returns the normalized part, or null if it isn't a valid name part. */
function parseNamePart(input: string): string | null {
  const part = input.normalize('NFC');
  if (!NAME_PART.test(part)) {
    return null;
  }
  const letters = [...part].filter((character) => LETTER.test(character)).length;
  if (letters < MIN_NAME_LETTERS || letters > MAX_NAME_LETTERS) {
    return null;
  }
  return capitalize(part);
}

/**
 * Parses `First` or `First-Last` (split on the first dash). Each part must be
 * 2-12 letters of any alphabet, no digits. A last name is optional here, but
 * if there is a dash it must be a valid name too. Casing is normalized to
 * `Xxxx`. Whether a last name is *required* depends on the guild's game
 * version (see game/game-version.ts).
 */
export function parseCharacterName(input: string): CharacterName | null {
  const [first, ...rest] = input.trim().split('-');
  const firstName = parseNamePart(first);
  if (firstName === null) {
    return null;
  }
  if (rest.length === 0) {
    return { firstName, lastName: '' };
  }
  const lastName = parseNamePart(rest.join('-'));
  return lastName === null ? null : { firstName, lastName };
}

export const formatCharacterName = ({ firstName, lastName }: CharacterName): string =>
  `${firstName} ${lastName}`.trim();
