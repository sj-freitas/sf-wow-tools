import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TEST_ARMORY } from '../armory/armory.config';
import { siteOrigin } from '../config/site-origin';

const AUTHORIZE_URL = 'https://oauth.battle.net/authorize';
const TOKEN_URL = 'https://oauth.battle.net/token';
const USERINFO_URL = 'https://oauth.battle.net/userinfo';
const REQUEST_TIMEOUT_MS = 8000;

/** One of the Battle.net account's characters on the server the check reads. */
export interface BattleNetCharacter {
  name: string;
  realm: string;
  level: number | null;
  class: string | null;
  race: string | null;
  faction: string | null;
}

interface AccountProfile {
  wow_accounts?: {
    characters?: {
      name?: string;
      level?: number;
      realm?: { name?: string; slug?: string };
      playable_class?: { name?: string };
      playable_race?: { name?: string };
      faction?: { name?: string };
    }[];
  }[];
}

export class BattleNetError extends Error {}

/**
 * Logging a player in on Battle.net (OAuth, `wow.profile`) to read their account's characters:
 * the check behind "Verify with Battle.net" on a character's page. A preview for now: it reads the
 * characters on one server (`TEST_ARMORY`, Wild Growth EU, Season of Discovery) and changes
 * nothing; at WoW Forever's launch it reads Forever's and verifies the character. Uses the same
 * Battle.net developer client as the armory (`BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`); the
 * client must list `redirectUri` (`BATTLENET_REDIRECT_URI`, else `<site>/api/battlenet/callback`).
 */
@Injectable()
export class BattleNetService {
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

  get redirectUri(): string {
    return (
      this.config.get<string>('BATTLENET_REDIRECT_URI') ||
      `${siteOrigin(this.config)}/api/battlenet/callback`
    );
  }

  /** The server the check reads, to show with the result. */
  readonly server = TEST_ARMORY.description;

  /** Where to send the player to log in on Battle.net and allow reading their characters. */
  authorizeUrl(state: string): string {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId ?? '',
      redirect_uri: this.redirectUri,
      scope: 'openid wow.profile',
      state,
    });
    return `${AUTHORIZE_URL}?${query.toString()}`;
  }

  /** The player's token, for the code Battle.net sent back. */
  async exchange(code: string): Promise<string> {
    const response = await this.request(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }).toString(),
    });
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) throw new BattleNetError('Battle.net sent no token.');
    return body.access_token;
  }

  /** The account's BattleTag ("Name#1234"), or null when Battle.net doesn't say. */
  async battleTag(token: string): Promise<string | null> {
    try {
      const response = await this.request(USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as { battletag?: string };
      return body.battletag ?? null;
    } catch {
      return null;
    }
  }

  /** The account's characters on the server the check reads, by name. */
  async characters(token: string): Promise<BattleNetCharacter[]> {
    const url =
      `https://${TEST_ARMORY.region}.api.blizzard.com/profile/user/wow` +
      `?namespace=${TEST_ARMORY.namespace}&locale=${TEST_ARMORY.locale}`;
    let response: Response;
    try {
      response = await this.request(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      // No characters in that game at all: Battle.net answers 404.
      if (error instanceof BattleNetError && error.message.includes('404')) return [];
      throw error;
    }
    const profile = (await response.json()) as AccountProfile;
    return (profile.wow_accounts ?? [])
      .flatMap((account) => account.characters ?? [])
      .filter((character) => character.realm?.slug === TEST_ARMORY.realmSlug && character.name)
      .map((character) => ({
        name: character.name!,
        realm: character.realm?.name ?? TEST_ARMORY.realmName,
        level: character.level ?? null,
        class: character.playable_class?.name ?? null,
        race: character.playable_race?.name ?? null,
        faction: character.faction?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BattleNetError(`Battle.net didn't answer: ${String(error)}`);
    }
    if (!response.ok) throw new BattleNetError(`Battle.net answered ${response.status}.`);
    return response;
  }
}
