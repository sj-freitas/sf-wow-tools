import type { Character, Guild, NewCharacterInput, Player, User } from './types';

export class UnauthorizedError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) {
    throw new UnauthorizedError('Not logged in');
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message ?? `${method} ${url} failed with status ${response.status}`);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const fetchPlayers = (): Promise<Player[]> => request('GET', '/api/players');

export const fetchGuilds = (): Promise<Guild[]> => request('GET', '/api/guilds');

export const createCharacter = (guildId: string, input: NewCharacterInput): Promise<void> =>
  request('POST', `/api/guilds/${guildId}/characters`, input);

export const updateCharacter = (
  id: string,
  patch: Partial<Pick<Character, 'isMain' | 'level'>>,
): Promise<void> => request('PATCH', `/api/characters/${id}`, patch);

export const deleteCharacter = (id: string): Promise<void> =>
  request('DELETE', `/api/characters/${id}`);

/** Returns the logged-in user, or null when there's no valid session. */
export async function fetchCurrentUser(): Promise<User | null> {
  try {
    return await request<User>('GET', '/api/auth/me');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return null;
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}
