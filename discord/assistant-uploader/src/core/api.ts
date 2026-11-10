/** Who an upload key is, and the guilds its uploads go to (`GET /api/upload/me`). */
export interface UploaderAccount {
  user: { name: string };
  guilds: { id: string; name: string }[];
}

/** What one guild did with an upload (the API's ImportResultDto, the parts shown here). */
export interface GuildImport {
  id: string;
  name: string;
  result: {
    imported: { name: string; relayed: boolean }[];
    skipped: { name: string }[];
  };
}

/** `POST /api/upload/professions`: the file imported into each of the player's guilds. */
export interface UploadResult {
  guilds: GuildImport[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    /** Guild Assistant's HTTP status; null when it couldn't be reached. */
    readonly status: number | null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 30_000;

/** Guild Assistant's two uploader endpoints, with an upload key (`Authorization: Bearer gak_…`). */
export class GuildAssistantApi {
  constructor(
    readonly site: string,
    private readonly userAgent: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  me(key: string): Promise<UploaderAccount> {
    return this.request(key, 'GET', '/api/upload/me');
  }

  /** `data`: the file as the game wrote it. */
  uploadProfessions(key: string, data: string): Promise<UploadResult> {
    return this.request(key, 'POST', '/api/upload/professions', { data });
  }

  private async request<T>(key: string, method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.site}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'User-Agent': this.userAgent,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ApiError(
        `Guild Assistant didn’t answer (${error instanceof Error ? error.message : String(error)}). Is this computer online?`,
        null,
      );
    }
    if (!response.ok) {
      // Guild Assistant's errors are `{ message }` (a list, for some).
      const answer = (await response.json().catch(() => null)) as { message?: unknown } | null;
      const message = Array.isArray(answer?.message)
        ? answer.message.join(' ')
        : typeof answer?.message === 'string'
          ? answer.message
          : `Guild Assistant answered ${response.status}.`;
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as T;
  }
}

/** One line for an upload: "Updated 3 characters in Alpha, 1 in Zeta." */
export function summarize(result: UploadResult): string {
  if (result.guilds.length === 0) {
    return 'You aren’t in a guild on Guild Assistant, so nothing was updated.';
  }
  const updated = result.guilds.filter((guild) => guild.result.imported.length > 0);
  if (updated.length === 0) {
    return 'None of its characters are on your guilds’ rosters, so nothing was updated.';
  }
  const [first, ...rest] = updated.map(
    (guild, index) =>
      `${guild.result.imported.length}${index === 0 ? ` character${guild.result.imported.length === 1 ? '' : 's'}` : ''} in ${guild.name}`,
  );
  return `Updated ${[first, ...rest].join(', ')}.`;
}
