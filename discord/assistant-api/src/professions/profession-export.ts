import { BadRequestException } from '@nestjs/common';

/**
 * The Guild Assistant Professions addon's export (addons/GuildAssistantProfessions): every character
 * of the account with its professions and recipe ids, and others' seen through a profession link.
 * The addon keeps it as a JSON string in its saved variables file
 * (WTF/Account/<account>/SavedVariables/GuildAssistantProfessions.lua), which is what gets uploaded.
 * The addon's test writes a sample to addons/dev/GuildAssistantProfessions/export.fixture.json,
 * read by our spec.
 */
export interface ProfessionExport {
  characters: ExportedCharacter[];
}

export interface ExportedCharacter {
  name: string;
  realm: string;
  class: string | null;
  /** "own": one of the account's; "link": someone else's, seen through a profession link. */
  source: 'own' | 'link';
  professions: ExportedProfession[];
}

export interface ExportedProfession {
  name: string;
  skill: number | null;
  max: number | null;
  /** Recipes as WoW spell ids; `items` when the game only gave the crafted item. */
  spells: number[];
  items: number[];
}

const MAX_CHARACTERS = 100;
const MAX_PROFESSIONS = 20;
const MAX_RECIPES = 3000;

const fail = (message: string): never => {
  throw new BadRequestException(
    `That isn't the Guild Assistant Professions file (${message}). In game, type /ga-prof status: it says where the file is.`,
  );
};

/**
 * The export from the saved variables file: the game writes the addon's data as Lua, with the
 * export as a string (`["export"] = "{\"addon\":…}"`). Null when the text has none.
 */
export function exportFromSavedVariables(text: string): string | null {
  const match = /\["export"\]\s*=\s*"((?:[^"\\]|\\[\s\S])*)"/.exec(text);
  if (!match) return null;
  // Lua's escapes, as the game writes them: \" \\ \n and \ddd (a byte, in decimal; bytes of one
  // UTF-8 character may come escaped one by one, so the text is put together as bytes).
  const bytes: Buffer[] = [];
  const pattern = /\\(\d{1,3}|[\s\S])|[^\\]+/g;
  for (const [part, escape] of match[1].matchAll(pattern)) {
    if (escape === undefined) bytes.push(Buffer.from(part, 'utf8'));
    else if (/^\d/.test(escape)) bytes.push(Buffer.from([Number(escape) & 0xff]));
    else bytes.push(Buffer.from({ n: '\n', r: '\r', t: '\t' }[escape] ?? escape, 'utf8'));
  }
  return Buffer.concat(bytes).toString('utf8');
}

const text = (value: unknown, what: string, max: number): string => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) fail(`bad ${what}`);
  return (value as string).trim();
};

const optionalInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 10000
    ? value
    : null;

const ids = (value: unknown, what: string): number[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RECIPES) fail(`bad ${what}`);
  const list = value as unknown[];
  if (!list.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0 && id < 1e8)) {
    fail(`bad ${what}`);
  }
  return [...new Set(list as number[])].sort((a, b) => a - b);
};

/** The uploaded saved variables file, or the export's JSON (as text or parsed), checked. */
export function parseProfessionExport(input: unknown): ProfessionExport {
  let data: unknown = input;
  if (typeof input === 'string') {
    const json = input.trim().startsWith('{') ? input : exportFromSavedVariables(input);
    if (json === null) fail('no export in it');
    try {
      data = JSON.parse(json!.trim());
    } catch {
      fail('not JSON');
    }
  }
  const root = data as { addon?: unknown; characters?: unknown } | null;
  if (!root || typeof root !== 'object' || root.addon !== 'GuildAssistantProfessions') {
    fail('not from the addon');
  }
  const characters = root!.characters;
  if (!Array.isArray(characters) || characters.length > MAX_CHARACTERS) fail('no characters');
  return {
    characters: (characters as Record<string, unknown>[]).map((character) => {
      const professions = character.professions;
      if (!Array.isArray(professions) || professions.length > MAX_PROFESSIONS) {
        fail('bad professions');
      }
      return {
        name: text(character.name, 'character name', 48),
        realm: text(character.realm, 'realm', 64),
        class: typeof character.class === 'string' ? character.class : null,
        source: character.source === 'link' ? 'link' : 'own',
        professions: (professions as Record<string, unknown>[]).map((profession) => ({
          name: text(profession.name, 'profession name', 64),
          skill: optionalInt(profession.skill),
          max: optionalInt(profession.max),
          spells: ids(profession.spells, 'recipes'),
          items: ids(profession.items, 'recipes'),
        })),
      };
    }),
  };
}

/** A name as compared: lower case, no accents, letters only ("Dark-Shivan" = "darkshivan"). */
export const nameKey = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

export interface OwnCharacter {
  id: string;
  firstName: string;
  lastName: string;
  realm: string;
}

/**
 * Which of the user's characters an exported one is: same name (the first name, or first and last
 * together, as Forever writes them), and on a tie the same realm. Null when none or still several.
 */
export function matchCharacter<C extends OwnCharacter>(
  exported: Pick<ExportedCharacter, 'name' | 'realm'>,
  own: readonly C[],
): C | null {
  const name = nameKey(exported.name);
  const named = own.filter(
    (character) =>
      nameKey(character.firstName) === name ||
      nameKey(`${character.firstName}${character.lastName}`) === name,
  );
  if (named.length <= 1) return named[0] ?? null;
  const sameRealm = named.filter(
    (character) => nameKey(character.realm) === nameKey(exported.realm),
  );
  return sameRealm.length === 1 ? sameRealm[0] : null;
}

/** Wowhead's address for a spell or item, with its name in it when known (as Wowhead writes it). */
export function wowheadUrl(
  path: string,
  kind: 'spell' | 'item',
  id: number,
  englishName: string | null,
): string {
  const slug = englishName
    ? englishName
        .toLowerCase()
        .replace(/'/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    : '';
  return `https://www.wowhead.com/${path}/${kind}=${id}${slug ? `/${slug}` : ''}`;
}
