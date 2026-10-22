import { request } from '../api';

/** Professions from the Guild Assistant Professions addon (API: src/professions). */

export interface Recipe {
  kind: 'spell' | 'item';
  id: number;
  /** English name from Wowhead; null until it has been looked up. */
  name: string | null;
  icon: string | null;
  url: string;
}

export interface Profession {
  name: string;
  skill: number | null;
  maxSkill: number | null;
  importedAt: string;
  recipes: Recipe[];
}

export interface ImportResult {
  imported: {
    characterId: string;
    name: string;
    /** A guildmate's, shared with the uploader's addon by theirs (guild sharing). */
    relayed: boolean;
    professions: { name: string; recipes: number }[];
  }[];
  skipped: { name: string; realm: string }[];
  /** Other players' characters, seen through profession links: not imported (yet). */
  linked: { name: string; realm: string }[];
  /** Characters from an addon before 1.0 (no dates): left out; the addon needs updating. */
  outdated: { name: string; realm: string }[];
  /** Professions dropped from a character that the file still has, from before the drop: left out. */
  dropped: { characterId: string; name: string; profession: string; droppedAt: string }[];
  /** Dropped before, learned again since (the file says): added back. */
  relearned: ProfessionChange[];
  /** Main professions a newer file no longer has (unlearned and replaced in game): dropped. */
  replaced: ProfessionChange[];
}

/** Everyone's professions in a guild: the characters, and every recipe with who can craft it. */
export interface GuildProfessions {
  characters: {
    id: string;
    name: string;
    /** For the character's page address. */
    firstName: string;
    lastName: string;
    class: string;
    /** Its player on Discord (null until known). */
    discordUserId: string | null;
    discordName: string | null;
    professions: {
      name: string;
      skill: number | null;
      maxSkill: number | null;
      importedAt: string;
    }[];
  }[];
  /** One per profession and recipe. */
  recipes: (Recipe & { profession: string; crafterIds: string[] })[];
}

export const fetchGuildProfessions = (guildId: string): Promise<GuildProfessions> =>
  request('GET', `/api/guilds/${guildId}/professions`);

/** A character's professions for its own page (no guild needed). */
export const fetchCharacterProfessions = (characterId: string): Promise<Profession[]> =>
  request('GET', `/api/characters/${characterId}/professions`);

/**
 * Drops a main profession (its recipes too): the character's player, or an Officer of a guild it
 * is in. Not Cooking, First Aid or Fishing.
 */
export const dropProfession = (characterId: string, name: string): Promise<void> =>
  request('DELETE', `/api/characters/${characterId}/professions/${encodeURIComponent(name)}`);

/** Everyone can have these, so they can't be dropped (the API's SECONDARY_PROFESSIONS). */
export const SECONDARY_PROFESSIONS: readonly string[] = ['Cooking', 'First Aid', 'Fishing'];

/**
 * Professions shown in two sections, main ones first and secondary ones (Cooking, First Aid,
 * Fishing) last, each keeping its order; a section with none is left out.
 */
export function professionSections<T>(
  items: readonly T[],
  name: (item: T) => string,
): { title: string; items: T[] }[] {
  const secondary = (item: T) => SECONDARY_PROFESSIONS.includes(name(item));
  return [
    { title: 'Professions', items: items.filter((item) => !secondary(item)) },
    { title: 'Secondary professions', items: items.filter(secondary) },
  ].filter((section) => section.items.length > 0);
}

export const fetchProfessions = (guildId: string, characterId: string): Promise<Profession[]> =>
  request('GET', `/api/guilds/${guildId}/characters/${characterId}/professions`);

export interface ProfessionChange {
  characterId: string;
  name: string;
  profession: string;
}

/** `data`: the addon's saved variables file (or its export's JSON). */
export const importProfessions = (guildId: string, data: string): Promise<ImportResult> =>
  request('POST', `/api/guilds/${guildId}/professions/import`, { data });
