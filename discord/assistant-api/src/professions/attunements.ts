/**
 * The raids with an attunement, as GuildAssistant Professions keys them (its own `Core.ATTUNEMENTS`,
 * where the quest per faction lives). `icon` is the game's icon for the raid, a file id, which the
 * website shows in place of its name (Blizzard's own CDN serves icons by file id, `raidIconUrl` in
 * the backoffice). The next raid is one more line here and there; a key is never renamed, since the
 * addon and the characters' rows hold it.
 */
export const ATTUNEMENTS: readonly { key: string; raid: string; icon: number }[] = [
  { key: 'ony', raid: "Onyxia's Lair", icon: 134154 },
];

/** A raid's name, or the key itself for one a newer addon knows and this doesn't. */
export const raidName = (key: string): string =>
  ATTUNEMENTS.find((attunement) => attunement.key === key)?.raid ?? key;

/** A raid's icon (a game file id), or null for one this API doesn't know. */
export const raidIcon = (key: string): number | null =>
  ATTUNEMENTS.find((attunement) => attunement.key === key)?.icon ?? null;

/**
 * A character's attunements as its page shows them: every raid this API knows, in order, then any
 * other key the character has a row for. `attuned` null means no one's addon has looked at that
 * character for that raid, which is not the same as not being attuned.
 */
export interface CharacterAttunementsDto {
  /** Whether anything at all has been imported for this character (nothing to show when not). */
  reported: boolean;
  raids: {
    key: string;
    raid: string;
    /** The game's icon for the raid (a file id); null for one this API doesn't know. */
    icon: number | null;
    attuned: boolean | null;
    /** When an import last said anything about it; null when none has. */
    recordedAt: string | null;
  }[];
}

/** The rows of `CharacterAttunementsDto` from what is stored for one character. */
export function attunementRows(
  stored: readonly { key: string; attuned: boolean; recordedAt: Date }[],
): CharacterAttunementsDto {
  const known = new Set(ATTUNEMENTS.map((attunement) => attunement.key));
  const extra = stored
    .map((row) => row.key)
    .filter((key) => !known.has(key))
    .sort();
  const keys = [...ATTUNEMENTS.map((attunement) => attunement.key), ...new Set(extra)];
  return {
    reported: stored.length > 0,
    raids: keys.map((key) => {
      const row = stored.find((one) => one.key === key);
      return {
        key,
        raid: raidName(key),
        icon: raidIcon(key),
        attuned: row ? row.attuned : null,
        recordedAt: row ? row.recordedAt.toISOString() : null,
      };
    }),
  };
}
