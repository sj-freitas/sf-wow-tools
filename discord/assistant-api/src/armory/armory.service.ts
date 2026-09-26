import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TEST_ARMORY } from './armory.config';

/** What the armory says about a character, reduced to what the character form fills in. */
export interface ArmoryCharacter {
  name: string;
  class: string;
  race: string;
  level: number;
  faction: string;
  realm: string;
}

/** Why a lookup gave nothing; the backoffice shows a message and everything stays manual. */
export type ArmoryFailure = 'not-configured' | 'not-found' | 'unavailable';

export class ArmoryError extends Error {
  constructor(
    readonly failure: ArmoryFailure,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 8000;
const TOKEN_URL = 'https://oauth.battle.net/token';
/** A few letters (any alphabet, WoW allows accents), never a path. */
const CHARACTER_NAME = /^\p{L}{2,24}$/u;

interface ProfileResponse {
  name?: string;
  faction?: { name?: string };
  race?: { name?: string };
  character_class?: { name?: string };
  realm?: { name?: string };
  level?: number;
}

/**
 * Reads a public character from Blizzard's armory API. It needs a Battle.net developer client
 * (`BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET`) and no player login: the server gets its own
 * token (client credentials) and asks for the character. TEST: only one server is supported (see
 * `armory.config.ts`), and Blizzard's data for it can be slow or missing, so a failure is normal.
 */
@Injectable()
export class ArmoryService {
  private readonly logger = new Logger(ArmoryService.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  /** For tests: how requests are made. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);

  get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private get clientId(): string | undefined {
    return this.config.get<string>('BLIZZARD_CLIENT_ID') || undefined;
  }

  private get clientSecret(): string | undefined {
    return this.config.get<string>('BLIZZARD_CLIENT_SECRET') || undefined;
  }

  async lookup(name: string): Promise<ArmoryCharacter> {
    if (!this.configured) {
      throw new ArmoryError('not-configured', 'The armory is not set up on this server.');
    }
    const trimmed = name.trim();
    if (!CHARACTER_NAME.test(trimmed)) {
      throw new ArmoryError('not-found', 'Type the character’s name first (letters only).');
    }
    const url =
      `https://${TEST_ARMORY.region}.api.blizzard.com/profile/wow/character/` +
      `${TEST_ARMORY.realmSlug}/${encodeURIComponent(trimmed.toLowerCase())}` +
      `?namespace=${TEST_ARMORY.namespace}&locale=${TEST_ARMORY.locale}`;

    let response = await this.get(url, await this.accessToken());
    if (response.status === 401) {
      // The token was refused (revoked, or clocks): get a new one once.
      this.token = null;
      response = await this.get(url, await this.accessToken());
    }
    if (response.status === 404) {
      throw new ArmoryError(
        'not-found',
        `No character called ${trimmed} was found on ${TEST_ARMORY.realmName} (${TEST_ARMORY.region.toUpperCase()}). It may be new, or its data may not have reached the armory yet.`,
      );
    }
    if (!response.ok) {
      this.logger.warn(`The armory answered ${response.status} for a character lookup`);
      throw new ArmoryError('unavailable', `The armory answered ${response.status}.`);
    }
    const profile = (await response.json()) as ProfileResponse;
    const { character_class: characterClass, race, faction, level } = profile;
    if (!characterClass?.name || !race?.name || typeof level !== 'number') {
      throw new ArmoryError(
        'unavailable',
        'The armory answer did not have the character’s class, race and level.',
      );
    }
    return {
      name: profile.name ?? trimmed,
      class: characterClass.name,
      race: race.name,
      level,
      faction: faction?.name ?? '',
      realm: profile.realm?.name ?? TEST_ARMORY.realmName,
    };
  }

  private async get(url: string, token: string): Promise<Response> {
    try {
      return await this.fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`The armory could not be reached: ${String(error)}`);
      throw new ArmoryError('unavailable', 'The armory could not be reached. Try again later.');
    }
  }

  /** A client-credentials token, kept until a minute before it expires. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    let response: Response;
    try {
      response = await this.fetcher(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Blizzard's login could not be reached: ${String(error)}`);
      throw new ArmoryError('unavailable', 'Blizzard could not be reached. Try again later.');
    }
    if (!response.ok) {
      this.logger.warn(`Blizzard refused the armory client (${response.status})`);
      throw new ArmoryError(
        'unavailable',
        'Blizzard refused the armory login. Check the Battle.net client id and secret.',
      );
    }
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new ArmoryError('unavailable', 'Blizzard sent no armory token.');
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000,
    };
    return this.token.value;
  }
}
