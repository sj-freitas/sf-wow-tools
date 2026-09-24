import type {
  CharacterPatch,
  Honeypot,
  HoneypotInput,
  PostInput,
  Reaction,
  ScheduledPost,
  ServerChannels,
  EligibleServers,
  Guild,
  GuildDetails,
  GuildRoleKey,
  NewCharacterInput,
  NewGuildInput,
  People,
  Player,
  PostsPage,
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

  // Some endpoints answer with no body (204, or 201 for creates), which json() can't parse.
  const text = await response.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
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

export const fetchTasks = (
  guildId: string,
  options: { query?: string; page?: number } = {},
): Promise<PostsPage> => {
  const params = new URLSearchParams();
  if (options.query) params.set('query', options.query);
  if (options.page && options.page > 1) params.set('page', String(options.page));
  const search = params.toString();
  return request('GET', `/api/guilds/${guildId}/tasks${search ? `?${search}` : ''}`);
};

export const fetchChannels = (guildId: string): Promise<ServerChannels[]> =>
  request('GET', `/api/guilds/${guildId}/channels`);

export const createTask = (guildId: string, input: PostInput): Promise<ScheduledPost> =>
  request('POST', `/api/guilds/${guildId}/tasks`, input);

export const updateTask = (id: string, input: Partial<PostInput>): Promise<ScheduledPost> =>
  request('PATCH', `/api/tasks/${id}`, input);

export const deleteTask = (id: string): Promise<void> => request('DELETE', `/api/tasks/${id}`);

/** Removes the message from Discord. The task stays and can be posted again. */
export const deletePostMessage = (id: string): Promise<void> =>
  request('POST', `/api/tasks/${id}/delete-post`);

export const runTaskNow = (id: string): Promise<void> =>
  request('POST', `/api/tasks/${id}/run-now`);

export const fetchTaskReactions = (id: string): Promise<Reaction[]> =>
  request('GET', `/api/tasks/${id}/reactions`);

export const fetchHoneypots = (guildId: string): Promise<Honeypot[]> =>
  request('GET', `/api/guilds/${guildId}/honeypots`);

export const createHoneypot = (guildId: string, input: HoneypotInput): Promise<Honeypot> =>
  request('POST', `/api/guilds/${guildId}/honeypots`, input);

export const updateHoneypot = (
  id: string,
  input: { name?: string; enabled?: boolean; testMode?: boolean; confirmLive?: boolean },
): Promise<Honeypot> => request('PATCH', `/api/honeypots/${id}`, input);

export const deleteHoneypot = (id: string): Promise<void> =>
  request('DELETE', `/api/honeypots/${id}`);

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
