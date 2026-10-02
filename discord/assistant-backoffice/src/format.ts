import type { Character, Player } from './types';

/** Best human-readable name we have for a player. */
export const playerLabel = (
  player: Pick<Player, 'discordUserId' | 'discordUsername' | 'discordDisplayName'>,
): string => player.discordDisplayName ?? player.discordUsername ?? player.discordUserId;

/**
 * A character's deep-link path segment: `Name-Lastname` (versions with last names) or `Name`.
 * Matches how the API splits it back apart (on the first dash) to look the character up.
 */
export const characterPath = (character: Pick<Character, 'firstName' | 'lastName'>): string =>
  character.lastName ? `${character.firstName}-${character.lastName}` : character.firstName;
