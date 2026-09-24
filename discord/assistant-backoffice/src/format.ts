import type { Player } from './types';

/** Best human-readable name we have for a player. */
export const playerLabel = (
  player: Pick<Player, 'discordUserId' | 'discordUsername' | 'discordDisplayName'>,
): string => player.discordDisplayName ?? player.discordUsername ?? player.discordUserId;
