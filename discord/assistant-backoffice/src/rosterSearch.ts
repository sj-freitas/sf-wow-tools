import { fuzzyScore } from './fuzzy';
import { ROLE_LABELS, type Character, type GuildAttribute, type Player } from './types';

/** Short words people type for a role, besides its label ("Melee DPS" also as "melee", "dps"). */
const ROLE_WORDS: Record<string, string[]> = {
  TANK: ['tank'],
  HEALER: ['healer', 'heal'],
  MELEE_DPS: ['melee', 'dps', 'mdps'],
  RANGED_DPS: ['ranged', 'range', 'dps', 'rdps'],
};

export interface RosterRow {
  player: Player;
  character: Character;
}

/**
 * Everything about a roster row that a search can find: the character's name, class, race,
 * roles, professions and what it can craft, attributes (a guild's "Main" among them) and level,
 * and its player's Discord names, Discord ID and ranks.
 */
function searchableText(
  { player, character }: RosterRow,
  attributes: readonly GuildAttribute[],
  ranks: readonly string[],
  professions: readonly string[],
): string[] {
  return [
    character.firstName,
    character.lastName,
    `${character.firstName} ${character.lastName}`.trim(),
    character.class,
    character.race,
    ...character.roles.flatMap((role) => [ROLE_LABELS[role], ...(ROLE_WORDS[role] ?? [])]),
    ...professions,
    ...attributes.map((attribute) => attribute.name),
    String(character.level),
    player.discordUsername ?? '',
    player.discordDisplayName ?? '',
    player.discordUserId,
    ...ranks,
  ].filter((text) => text !== '');
}

/**
 * The rows that match a search, best matches first. Every word of the query must match something
 * about the row (so "warr tank" is warrior tanks): the start of a word ("Warr" finds warriors),
 * any part of it, or the word with a typo or two (names especially). With no query, every row in
 * its order.
 */
export function searchRoster(
  rows: readonly RosterRow[],
  query: string,
  attributesOf: (characterId: string) => readonly GuildAttribute[],
  ranksOf: (discordUserId: string) => readonly string[],
  professionsOf: (characterId: string) => readonly string[] = () => [],
): RosterRow[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  const scored: { row: RosterRow; score: number; index: number }[] = [];
  rows.forEach((row, index) => {
    const text = searchableText(
      row,
      attributesOf(row.character.id),
      ranksOf(row.player.discordUserId),
      professionsOf(row.character.id),
    );
    let total = 0;
    for (const word of words) {
      const score = fuzzyScore(word, text);
      if (score === null) return;
      total += score;
    }
    scored.push({ row, score: total, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((entry) => entry.row);
}
