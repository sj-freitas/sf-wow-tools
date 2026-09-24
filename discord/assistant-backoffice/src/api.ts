import type {
  CharacterPatch,
  EligibleServers,
  Guild,
  GuildDetails,
  NewCharacterInput,
  NewGuildInput,
  Person,
  Player,
  RoleOption,
  SetupInfo,
  User,
} from './types';

export class UnauthorizedError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    const message = detail?.message ?? `${method} ${url} failed with status ${response.status}`;
    throw response.status === 401 ? new UnauthorizedError(message) : new Error(message);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const fetchPlayers = (): Promise<Player[]> => request('GET', '/api/players');

export const fetchGuilds = (): Promise<Guild[]> => request('GET', '/api/guilds');

export const fetchSetupInfo = (): Promise<SetupInfo> => request('GET', '/api/guilds/setup-info');

export const fetchEligibleServers = (): Promise<EligibleServers> =>
  request('GET', '/api/guilds/eligible-servers');

export const createGuild = (input: NewGuildInput): Promise<Guild> =>
  request('POST', '/api/guilds', input);

export const removeGuildServer = (guildId: string, discordServerId: string): Promise<void> =>
  request('DELETE', `/api/guilds/${guildId}/servers/${discordServerId}`);

export const updateGuild = (guildId: string, details: GuildDetails): Promise<void> =>
  request('PATCH', `/api/guilds/${guildId}`, details);

export const deleteGuild = (guildId: string): Promise<void> =>
  request('DELETE', `/api/guilds/${guildId}`);

export const addGuildServer = (guildId: string, discordServerId: string): Promise<void> =>
  request('POST', `/api/guilds/${guildId}/servers`, { discordServerId });

export const setMainServer = (guildId: string, discordServerId: string): Promise<void> =>
  request('PUT', `/api/guilds/${guildId}/main-server`, { discordServerId });

export const fetchOfficerRoleOptions = (guildId: string): Promise<RoleOption[]> =>
  request('GET', `/api/guilds/${guildId}/officer-role-options`);

export const setOfficerRole = (guildId: string, roleId: string | null): Promise<void> =>
  request('PUT', `/api/guilds/${guildId}/officer-role`, { roleId });

export const fetchPeople = (guildId: string): Promise<Person[]> =>
  request('GET', `/api/guilds/${guildId}/people`);

export const createCharacter = (guildId: string, input: NewCharacterInput): Promise<void> =>
  request('POST', `/api/guilds/${guildId}/characters`, input);

export const updateCharacter = (id: string, patch: CharacterPatch): Promise<void> =>
  request('PATCH', `/api/characters/${id}`, patch);

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
