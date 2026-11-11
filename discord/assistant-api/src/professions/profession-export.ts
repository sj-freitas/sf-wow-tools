import { BadRequestException } from '@nestjs/common';

/**
 * The GuildAssistant Professions addon's export (addons/GuildAssistantProfessions): every character
 * of the account with its professions and recipe ids, and others' seen through a profession link.
 * The addon keeps it as a JSON string in its saved variables file
 * (WTF/Account/<account>/SavedVariables/GuildAssistantProfessions.lua), which is what gets uploaded.
 * The addon's test writes a sample to addons/dev/GuildAssistantProfessions/export.fixture.json,
 * read by our spec.
 */
export interface ProfessionExport {
  /** 1: the addon before 1.0 (no dates by the game server); 2: 1.0 and later. */
  format: number;
  characters: ExportedCharacter[];
  /** How recipes are obtained, as the addon saw it in game (1.3.0 and later); null without any. */
  sources: ExportedSources | null;
}

/**
 * What the addon recorded of how recipes are obtained (RecipeSourcesService keeps it for
 * GuildAssistant Database). Entries are as the addon writes them.
 */
export interface ExportedSources {
  /** Recipe items, and where each comes from: "V:Tanaris=Krinkle Goodsteel" (V vendor, D drop, O object, F fishing, Q quest; the zone; who). */
  items: { id: number; entries: string[] }[];
  /** Recipes a trainer teaches ("item:<item made>" or "name:<recipe>"), the cost, and "<zone>=<trainer>". */
  trainers: { recipe: string; cost: number | null; entries: string[] }[];
}

export interface ExportedCharacter {
  name: string;
  realm: string;
  class: string | null;
  /**
   * "own": one of the account's; "guild": a guildmate's, received from their addon (guild sharing,
   * 1.0+); "link": someone else's, seen through a profession link.
   */
  source: 'own' | 'guild' | 'link';
  /** Its last change in game (game server time, 1.0+), else null: the newer export wins. */
  updated: Date | null;
  professions: ExportedProfession[];
}

export interface ExportedProfession {
  name: string;
  skill: number | null;
  max: number | null;
  /** Recipes as WoW spell ids; `items` when the game only gave the crafted item. */
  spells: number[];
  items: number[];
  /** When the character learned it and last changed it (1.0+; game server time), else null. */
  learned: Date | null;
  updated: Date | null;
}

const MAX_CHARACTERS = 100;
const MAX_PROFESSIONS = 20;
const MAX_RECIPES = 3000;

const fail = (message: string): never => {
  throw new BadRequestException(
    `That isn't the GuildAssistant Professions file (${message}). In game, type /ga-prof status: it says where the file is.`,
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

/** A Unix time in seconds, as the addon writes them (from 2020 to 2100), else null. */
const time = (value: unknown): Date | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 1.5e9 && value < 4.1e9
    ? new Date(value * 1000)
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

const ITEM_ENTRY = /^[VDOFQ](\d{1,6}|:[^=;\t]{1,60})?=[^;\t]{0,60}$/;
const TRAINER_ENTRY = /^[^=;\t]{0,60}=[^=;\t]{1,60}$/;
const TRAINER_RECIPE = /^(item:\d{1,8}|name:[^=;\t]{1,80})$/;
const MAX_SOURCE_ENTRIES = 2000;

/**
 * The export's recipe sources, checked. Never fails the import: anything that isn't one (from
 * someone's edited file, say) is left out, and at most MAX_SOURCE_ENTRIES are taken.
 */
export function parseSources(value: unknown): ExportedSources | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as { items?: unknown; trainers?: unknown };
  let budget = MAX_SOURCE_ENTRIES;
  const entries = (list: unknown, pattern: RegExp): string[] => {
    if (!Array.isArray(list)) return [];
    const good = [
      ...new Set(list.filter((e): e is string => typeof e === 'string' && pattern.test(e))),
    ].slice(0, Math.max(0, Math.min(12, budget)));
    budget -= good.length;
    return good;
  };
  const items: ExportedSources['items'] = [];
  for (const item of Array.isArray(root.items) ? (root.items as Record<string, unknown>[]) : []) {
    const id = item?.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || id >= 1e8) continue;
    const list = entries(item.entries, ITEM_ENTRY);
    if (list.length > 0) items.push({ id, entries: list });
  }
  const trainers: ExportedSources['trainers'] = [];
  for (const trainer of Array.isArray(root.trainers)
    ? (root.trainers as Record<string, unknown>[])
    : []) {
    if (typeof trainer?.recipe !== 'string' || !TRAINER_RECIPE.test(trainer.recipe)) continue;
    const list = entries(trainer.entries, TRAINER_ENTRY);
    const cost =
      typeof trainer.cost === 'number' &&
      Number.isInteger(trainer.cost) &&
      trainer.cost > 0 &&
      trainer.cost < 1e8
        ? trainer.cost
        : null;
    if (list.length > 0) trainers.push({ recipe: trainer.recipe, cost, entries: list });
  }
  return items.length > 0 || trainers.length > 0 ? { items, trainers } : null;
}

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
  const root = data as {
    addon?: unknown;
    format?: unknown;
    characters?: unknown;
    sources?: unknown;
  } | null;
  if (!root || typeof root !== 'object' || root.addon !== 'GuildAssistantProfessions') {
    fail('not from the addon');
  }
  const characters = root!.characters;
  if (!Array.isArray(characters) || characters.length > MAX_CHARACTERS) fail('no characters');
  return {
    format: typeof root!.format === 'number' ? root!.format : 1,
    sources: parseSources(root!.sources),
    characters: (characters as Record<string, unknown>[]).map((character) => {
      const professions = character.professions;
      if (!Array.isArray(professions) || professions.length > MAX_PROFESSIONS) {
        fail('bad professions');
      }
      return {
        name: text(character.name, 'character name', 48),
        realm: text(character.realm, 'realm', 64),
        class: typeof character.class === 'string' ? character.class : null,
        source:
          character.source === 'link' ? 'link' : character.source === 'guild' ? 'guild' : 'own',
        updated: time(character.updated),
        professions: (professions as Record<string, unknown>[]).map((profession) => ({
          name: text(profession.name, 'profession name', 64),
          skill: optionalInt(profession.skill),
          max: optionalInt(profession.max),
          spells: ids(profession.spells, 'recipes'),
          items: ids(profession.items, 'recipes'),
          learned: time(profession.learned),
          updated: time(profession.updated),
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
