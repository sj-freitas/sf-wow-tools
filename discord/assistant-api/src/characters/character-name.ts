export interface CharacterName {
  firstName: string;
  lastName: string;
}

const NAME_PART = /^\p{L}{2,12}$/u;

const capitalize = (part: string): string =>
  part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase();

/**
 * Parses `First` or `First-Last` (split on the first dash). Returns null if
 * either part isn't 2-12 letters. Casing is normalized to `Xxxx`.
 */
export function parseCharacterName(input: string): CharacterName | null {
  const [first, ...rest] = input.trim().split('-');
  const last = rest.join('-');
  if (!NAME_PART.test(first) || (last !== '' && !NAME_PART.test(last))) {
    return null;
  }
  return { firstName: capitalize(first), lastName: last === '' ? '' : capitalize(last) };
}

export const formatCharacterName = ({ firstName, lastName }: CharacterName): string =>
  `${firstName} ${lastName}`.trim();
