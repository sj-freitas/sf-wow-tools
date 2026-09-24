import type {
  CharacterPatch,
  EligibleServers,
  Guild,
  GuildDetails,
  GuildRoleKey,
  NewCharacterInput,
  NewGuildInput,
  People,
  Player,
  Ranks,
  RoleOption,
  SetupInfo,
  User,
} from './types';

export class UnauthorizedError extends Error {}

/** Full-page navigation: the API redirects to Discord (no consent screen when already approved) and back. */
export const redirectToLogin = (): void => window.location.assign('/api/auth/login');

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  { redirectOn401 = true }: { redirectOn401?: boolean } = {},
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    const message = detail?.message ?? `${method} ${url} failed with status ${response.status}`;
    if (response.status === 401) {
      // Session or Discord authorization expired: send the user through login again.
      if (redirectOn401) {
        redirectToLogin();
      }
      throw new UnauthorizedError(message);
    }
    throw new Error(message);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const fetchPlayers = (): Promise<Player[]> => request('GET', '/api/players');

export const fetchGuilds = (): Promise<Guild[]> => request('GET', '/api/guilds');

export const fetchSetupInfo = (): Promise<SetupInfo> => request('GET', '/api/guilds/setup-info');

/** Asks the API to re-read the user's Discord servers and roles (rate limited server side). */
export const syncDiscord = (): Promise<void> => request('POST', '/api/guilds/sync');

export const fetchRanks = (guildId: string): Promise<Ranks> =>
  request('GET', `/api/guilds/${guildId}/ranks`);

export const fetchEligibleServers = (): Promise<EligibleServers> =>
  request('GET', '/api/guilds/eligible-servers');

export const refreshPlayerNames = (guildId: string): Promise<{ updated: number }> =>
  request('POST', `/api/players/guild/${guildId}/refresh-names`);

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

export const fetchRoleOptions = (guildId: string): Promise<RoleOption[]> =>
  request('GET', `/api/guilds/${guildId}/role-options`);

export const setRoleMapping = (
  guildId: string,
  guildRole: GuildRoleKey,
  roleId: string | null,
): Promise<void> => request('PUT', `/api/guilds/${guildId}/role-mappings/${guildRole}`, { roleId });

export const setOfficerRole = (guildId: string, roleId: string | null): Promise<void> =>
  request('PUT', `/api/guilds/${guildId}/officer-role`, { roleId });

export const fetchPeople = (guildId: string): Promise<People> =>
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
    return await request<User>('GET', '/api/auth/me', undefined, { redirectOn401: false });
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
