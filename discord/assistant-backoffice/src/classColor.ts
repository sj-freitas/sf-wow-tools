import { useGames } from './game';

/** The neutral grey of a class whose colour isn't in the game config. */
const NO_COLOR = '#8a8494';

/**
 * The class colours of a game version, from its config (`classes.<name>.color`). The version may
 * be written in any casing (character pages only have it from their address: `forever`).
 */
export function useClassColor(gameVersion: string): (className: string | null) => string {
  const game = useGames().find(
    (candidate) => candidate.gameVersion.toLowerCase() === gameVersion.toLowerCase(),
  );
  return (className) => (className && game?.classes[className]?.color) || NO_COLOR;
}
