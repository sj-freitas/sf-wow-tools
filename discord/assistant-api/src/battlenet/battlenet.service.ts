import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { siteOrigin } from '../config/site-origin';
import { armoryNamespaceFor, armoryRulesetOf } from '../game/games';

const AUTHORIZE_URL = 'https://oauth.battle.net/authorize';
const TOKEN_URL = 'https://oauth.battle.net/token';
const USERINFO_URL = 'https://oauth.battle.net/userinfo';
const REQUEST_TIMEOUT_MS = 8000;

/** Where the check reads characters: the character's own version, region and server. */
export interface BattleNetServer {
  gameVersion: string;
  /** `EU`, `US`. */
  region: string;
  /** The server's name in the game config (`RP`), not the armory's (`Roleplay`). */
  server: string;
}

/** "EU · Forever · RP": the server the check read, to show with the result. */
export const serverLabel = ({ gameVersion, region, server }: BattleNetServer): string =>
  `${region.toUpperCase()} · ${gameVersion} · ${server}`;

/** One of the Battle.net account's characters on the server the check reads. */
export interface BattleNetCharacter {
  /** In full: "Aqua Aquantos" (with its last name, in a version that has them). */
  name: string;
  level: number | null;
  class: string | null;
  race: string | null;
  faction: string | null;
}

interface AccountProfile {
  wow_accounts?: {
    characters?: {
      name?: string;
      /** Forever: the last name, and the rule set it plays under (it has no realm). */
      surname?: string;
      ruleset?: { name?: string; id?: number };
      level?: number;
      playable_class?: { name?: string };
      playable_race?: { name?: string };
      faction?: { name?: string };
    }[];
  }[];
}

export class BattleNetError extends Error {}

/**
 * Logging a player in on Battle.net (OAuth, `wow.profile`) to read their account's characters:
 * the check behind "Verify with Battle.net" on a character's page. It reads the characters on the
 * character's own server: its version's armory (`armoryNamespace`), its region, and its server's
 * rule set as the armory names it (`armoryRuleset` in the game config, "Roleplay" for RP). A
 * preview for now: it changes nothing. Uses the same
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

  /** The account's characters on `where`, the character's server, by name. */
  async characters(token: string, where: BattleNetServer): Promise<BattleNetCharacter[]> {
    const namespace = armoryNamespaceFor(where.gameVersion, where.region);
    if (!namespace) {
      throw new BattleNetError(`${where.gameVersion} has no armory to read characters from.`);
    }
    const ruleset = armoryRulesetOf(where.gameVersion, where.region, where.server);
    if (!ruleset) throw new BattleNetError(`${serverLabel(where)} isn’t a server we know.`);
    const region = where.region.toLowerCase();
    const url =
      `https://${region}.api.blizzard.com/profile/user/wow` +
      `?namespace=${namespace}&locale=${region === 'us' ? 'en_US' : 'en_GB'}`;
    let response: Response;
    try {
      response = await this.request(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      // No characters in that game at all: Battle.net answers 404.
      if (error instanceof BattleNetError && error.message.includes('404')) return [];
      throw error;
    }
    const profile = (await response.json()) as AccountProfile;
    const all = (profile.wow_accounts ?? []).flatMap((account) => account.characters ?? []);
    // Better an error than "no characters" for an answer that doesn't say where each one plays.
    if (all.length > 0 && all.every((character) => !character.ruleset?.name)) {
      throw new BattleNetError('Battle.net didn’t say which server your characters are on.');
    }
    return all
      .filter(
        (character) =>
          character.name && character.ruleset?.name?.toLowerCase() === ruleset.toLowerCase(),
      )
      .map((character) => ({
        name: [character.name!, character.surname].filter(Boolean).join(' '),
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
