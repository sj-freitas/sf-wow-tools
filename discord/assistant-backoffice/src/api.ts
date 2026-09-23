import type { Player, User } from './types';

export class UnauthorizedError extends Error {}

export async function fetchPlayers(): Promise<Player[]> {
  const response = await fetch('/api/players');

  if (response.status === 401) {
    throw new UnauthorizedError('Not logged in');
  }
  if (!response.ok) {
    throw new Error(`GET /api/players failed with status ${response.status}`);
  }

  return (await response.json()) as Player[];
}

/** Returns the logged-in user, or null when there's no valid session. */
export async function fetchCurrentUser(): Promise<User | null> {
  const response = await fetch('/api/auth/me');

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GET /api/auth/me failed with status ${response.status}`);
  }

  return (await response.json()) as User;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}
