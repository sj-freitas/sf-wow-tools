import type {
  CharacterPatch,
  Conversation,
  ConversationsPage,
  Honeypot,
  HoneypotInput,
  PostInput,
  Reaction,
  ScheduledPost,
  ServerChannels,
  EligibleServers,
  Guild,
  GuildDetails,
  GuildHome,
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
export const redirectToLogin = (): void => {
  rememberReturnPath();
  window.location.assign('/api/auth/login');
};

const RETURN_KEY = 'guildAssistant.returnTo';

/** Remembers the current page so that, after logging in, the user lands back on it. */
export function rememberReturnPath(): void {
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search);
  } catch {
    // Storage can be unavailable (private windows); the user just lands on the home page.
  }
}

/** The page remembered before login, once; null if there is none. */
export function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  { redirectOn401 = true }: { redirectOn401?: boolean } = {},
): Promise<T> {
  const response = await fetch(url, {
    method,
    // A FormData body (a file upload) sets its own content type.
    headers:
      body === undefined || body instanceof FormData
        ? undefined
        : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
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

export const fetchPlayers = (guildId: string): Promise<Player[]> =>
  request('GET', `/api/guilds/${guildId}/players`);

export const bannerUrl = (guild: { id: string; bannerVersion: number | null }): string =>
  `/api/guilds/${guild.id}/banner?v=${guild.bannerVersion ?? 0}`;

/** Uploads the image itself as the request body. */
export async function uploadBanner(guildId: string, file: File): Promise<void> {
  const response = await fetch(`/api/guilds/${guildId}/banner`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (response.status === 401) {
    redirectToLogin();
    throw new UnauthorizedError('Not logged in');
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message ?? `Upload failed with status ${response.status}`);
  }
}

export const removeBanner = (guildId: string): Promise<void> =>
  request('DELETE', `/api/guilds/${guildId}/banner`);

export const fetchGuilds = (): Promise<Guild[]> => request('GET', '/api/guilds');

export const fetchSetupInfo = (): Promise<SetupInfo> => request('GET', '/api/guilds/setup-info');

/** Asks the API to re-read the user's Discord servers and roles (rate limited server side). */
export const syncDiscord = (): Promise<void> => request('POST', '/api/guilds/sync');

export const fetchRanks = (guildId: string): Promise<Ranks> =>
  request('GET', `/api/guilds/${guildId}/ranks`);

export const fetchEligibleServers = (): Promise<EligibleServers> =>
  request('GET', '/api/guilds/eligible-servers');

export const refreshPlayerNames = (guildId: string): Promise<{ updated: number }> =>
  request('POST', `/api/guilds/${guildId}/players/refresh-names`);

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

export const fetchOfficerRequests = (
  guildId: string,
  options: { query?: string; page?: number } = {},
): Promise<ConversationsPage> => {
  const params = new URLSearchParams();
  if (options.query) params.set('query', options.query);
  if (options.page && options.page > 1) params.set('page', String(options.page));
  const search = params.toString();
  return request('GET', `/api/guilds/${guildId}/officer-requests${search ? `?${search}` : ''}`);
};

export const fetchOfficerRequest = (guildId: string, publicId: string): Promise<Conversation> =>
  request('GET', `/api/guilds/${guildId}/officer-requests/${publicId}`);

/** Sends an officer's reply; `dmDelivered` is false when the member could not be reached by DM. */
export const replyToOfficerRequest = (
  guildId: string,
  publicId: number,
  message: string,
  image?: File,
): Promise<{ dmDelivered: boolean }> => {
  const url = `/api/guilds/${guildId}/officer-requests/${publicId}/replies`;
  if (!image) return request('POST', url, { message });
  const form = new FormData();
  form.append('message', message);
  form.append('image', image);
  return request('POST', url, form);
};

export const officerMessageImageUrl = (guildId: string, publicId: number, messageId: string) =>
  `/api/guilds/${guildId}/officer-requests/${publicId}/messages/${messageId}/image`;

/** A locked conversation takes no more messages, from members or officers. */
export const setOfficerRequestLocked = (
  guildId: string,
  publicId: number,
  locked: boolean,
): Promise<void> =>
  request('PUT', `/api/guilds/${guildId}/officer-requests/${publicId}/lock`, { locked });

/** Removes the conversation and its messages in the request channel (not the members' DMs). */
export const deleteOfficerRequest = (
  guildId: string,
  publicId: number,
): Promise<{ notDeleted: number }> =>
  request('DELETE', `/api/guilds/${guildId}/officer-requests/${publicId}`);

/** `null` clears the channel. */
export const setOfficerRequestChannel = (
  guildId: string,
  target: { serverId: string; channelId: string } | null,
): Promise<void> =>
  request('PUT', `/api/guilds/${guildId}/officer-request-channel`, target ?? { channelId: null });

export const fetchHome = (guildId: string): Promise<GuildHome> =>
  request('GET', `/api/guilds/${guildId}/home`);

/** An empty text removes the welcome post. */
export const saveHome = (guildId: string, markdown: string): Promise<GuildHome> =>
  request('PUT', `/api/guilds/${guildId}/home`, { markdown });

export const fetchTask = (id: string): Promise<ScheduledPost> => request('GET', `/api/tasks/${id}`);

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

/** Who reacted with one emoji (the bot left out). */
export const fetchReactionUsers = (
  id: string,
  emoji: string,
  part = 1,
): Promise<{ id: string; name: string }[]> =>
  request(
    'GET',
    `/api/tasks/${id}/reactions/users?emoji=${encodeURIComponent(emoji)}&part=${part}`,
  );

export const fetchTaskReactions = (id: string, part = 1): Promise<Reaction[]> =>
  request('GET', `/api/tasks/${id}/reactions?part=${part}`);

/** Uploads an image for a message of a post; returns its id. */
export function uploadPostImage(guildId: string, file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.append('image', file);
  return request('POST', `/api/guilds/${guildId}/post-images`, form);
}

export const postImageUrl = (guildId: string, imageId: string): string =>
  `/api/guilds/${guildId}/post-images/${imageId}`;

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
