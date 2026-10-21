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
    professions: { name: string; recipes: number }[];
  }[];
  skipped: { name: string; realm: string }[];
  /** Other players' characters, seen through profession links: not imported (yet). */
  linked: { name: string; realm: string }[];
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

export const fetchProfessions = (guildId: string, characterId: string): Promise<Profession[]> =>
  request('GET', `/api/guilds/${guildId}/characters/${characterId}/professions`);

/** `data`: the addon's saved variables file (or its export's JSON). */
export const importProfessions = (guildId: string, data: string): Promise<ImportResult> =>
  request('POST', `/api/guilds/${guildId}/professions/import`, { data });
