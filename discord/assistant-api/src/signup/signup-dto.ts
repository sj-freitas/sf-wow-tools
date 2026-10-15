import { formatCharacterName } from '../characters/character-name';
import type { EntryRow } from './signup-events.service';

/** One sign-up as the backoffice gets it. `note` only for organisers and the person themselves. */
export const toEntryDto = (entry: EntryRow, withNote: boolean) => ({
  id: entry.id,
  discordUserId: entry.discordUserId,
  discordName: entry.discordName,
  characterId: entry.characterId,
  characterName: entry.character ? formatCharacterName(entry.character) : null,
  characterClass: entry.character?.class ?? null,
  role: entry.role,
  status: entry.status,
  note: withNote ? entry.note : null,
  groupNumber: entry.groupNumber,
  groupSlot: entry.groupSlot,
  /** When they first answered: the order of the sign-up numbers. */
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
});
