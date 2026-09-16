import type { Player } from './types';

export async function fetchPlayers(): Promise<Player[]> {
  const response = await fetch('/api/players');

  if (!response.ok) {
    throw new Error(`GET /api/players failed with status ${response.status}`);
  }

  return (await response.json()) as Player[];
}
