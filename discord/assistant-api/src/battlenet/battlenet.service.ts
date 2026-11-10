import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArmoryError, ArmoryService } from '../armory/armory.service';
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

/** "EU · Forever · RP": the character's server, to show with the result. */
export const serverLabel = ({ gameVersion, region, server }: BattleNetServer): string =>
  `${region.toUpperCase()} · ${gameVersion} · ${server}`;

/** "EU · Forever": where the account's characters were read (every server of the region). */
export const accountLabel = ({ gameVersion, region }: BattleNetServer): string =>
  `${region.toUpperCase()} · ${gameVersion}`;

/** One of the Battle.net account's characters in the version and region the check reads. */
export interface BattleNetCharacter {
  /** Blizzard's id for it, the same as in the armory; null when Battle.net doesn't give it. */
  id: number | null;
  /** In full: "Aqua Aquantos" (with its last name, in a version that has them). */
  name: string;
  level: number | null;
  class: string | null;
  race: string | null;
  faction: string | null;
  /** Its server's rule set ("Roleplay") when Battle.net says; null when not (Forever's list doesn't). */
  server: string | null;
}

/** The character as the armory has it: its id, and its server's rule set ("Roleplay"). */
export interface ArmoryEntry {
  id: number | null;
  ruleset: string;
}

interface AccountProfile {
  wow_accounts?: {
    characters?: {
      id?: number;
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
 * the check behind "Verify with Battle.net" on a character's page. Two reads: the account's
 * characters in the character's version and region (its version's `armoryNamespace`), which says
 * whether the character is theirs; and the character itself in the armory, which says its
 * server's rule set, checked against the server the character is on (`armoryRuleset` in the game
 * config, "Roleplay" for RP). The account's list can't say that itself: Forever's has no servers.
 * When both pass, the controller marks the character verified. Uses the same
 * Battle.net developer client as the armory (`BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`); the
 * client must list `redirectUri` (`BATTLENET_REDIRECT_URI`, else `<site>/api/battlenet/callback`).
 */
@Injectable()
export class BattleNetService {
  private readonly logger = new Logger(BattleNetService.name);
  /** The fields of the account list's characters were logged once (what Battle.net sends). */
  private shapeLogged = false;

  constructor(
    private readonly config: ConfigService,
    private readonly armory: ArmoryService,
  ) {}

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

  /** The rule set `where`'s server is in the armory ("Roleplay" for RP); throws if unknown. */
  ruleset(where: BattleNetServer): string {
    const ruleset = armoryRulesetOf(where.gameVersion, where.region, where.server);
    if (!ruleset) throw new BattleNetError(`${serverLabel(where)} isn’t a server we know.`);
    return ruleset;
  }

  /**
   * The character in the armory (by its full name, in its version and region): its id and its
   * server's rule set. Null when the armory doesn't have it (new, or not there yet).
   */
  async armoryEntry(
    where: BattleNetServer,
    name: string,
    lastName: string,
  ): Promise<ArmoryEntry | null> {
    const namespace = this.namespace(where);
    try {
      const found = await this.armory.lookup(
        { namespace, region: where.region, name, lastName },
        { talents: false },
      );
      return { id: found.id ?? null, ruleset: found.realm };
    } catch (error) {
      if (error instanceof ArmoryError && error.failure === 'not-found') return null;
      throw new BattleNetError(
        `The armory couldn’t be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The account's characters in `where`'s version and region (every server), by name. */
  async characters(token: string, where: BattleNetServer): Promise<BattleNetCharacter[]> {
    const namespace = this.namespace(where);
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
    if (!this.shapeLogged && all.length > 0) {
      // Which fields Battle.net gives for this version (names only, nothing about the player).
      this.shapeLogged = true;
      this.logger.log(
        `Battle.net account list (${namespace}): characters have ${Object.keys(all[0]).join(', ')}`,
      );
    }
    return all
      .filter((character) => character.name)
      .map((character) => ({
        id: typeof character.id === 'number' ? character.id : null,
        name: [character.name!, character.surname].filter(Boolean).join(' '),
        level: character.level ?? null,
        class: character.playable_class?.name ?? null,
        race: character.playable_race?.name ?? null,
        faction: character.faction?.name ?? null,
        server: character.ruleset?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private namespace(where: BattleNetServer): string {
    const namespace = armoryNamespaceFor(where.gameVersion, where.region);
    if (!namespace) {
      throw new BattleNetError(`${where.gameVersion} has no armory to read characters from.`);
    }
    return namespace;
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
