import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TalentBuild } from './spec-roles';

/** What the armory says about a character, reduced to what the character form fills in. */
export interface ArmoryCharacter {
  name: string;
  class: string;
  race: string;
  level: number;
  faction: string;
  realm: string;
  /** EXPERIMENTAL: its talent builds (the active one, and a second with dual spec); null when the
   *  armory gave none (see spec-roles.ts for what they're used for). */
  talents: TalentBuild[] | null;
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

/**
 * The armory's `/specializations` for a Classic character: talent groups (two with dual spec), each
 * with its trees and the points spent in them. Read loosely: the shape isn't documented for Classic
 * Era, so a tree's name is taken from either field, and a single list without groups is one build.
 */
interface SpecializationsResponse {
  specialization_groups?: { is_active?: boolean; specializations?: TreeResponse[] }[];
  specializations?: TreeResponse[];
}
interface TreeResponse {
  specialization_name?: string;
  specialization?: { name?: string };
  spent_points?: number;
}

function parseTalents(body: SpecializationsResponse): TalentBuild[] | null {
  const trees = (list: TreeResponse[] | undefined) =>
    (list ?? []).flatMap((tree) => {
      const name = tree.specialization_name ?? tree.specialization?.name;
      return name ? [{ name, points: tree.spent_points ?? 0 }] : [];
    });
  const builds = body.specialization_groups?.length
    ? body.specialization_groups.map((group) => ({
        active: group.is_active ?? false,
        trees: trees(group.specializations),
      }))
    : [{ active: true, trees: trees(body.specializations) }];
  const found = builds.filter((build) => build.trees.length > 0);
  return found.length > 0 ? found : null;
}

interface ProfileResponse {
  name?: string;
  faction?: { name?: string };
  race?: { name?: string };
  character_class?: { name?: string };
  realm?: { name?: string };
  /** Forever: the last name, and the rule set the character plays under (it has no realm). */
  surname?: string;
  ruleset?: { name?: string };
  level?: number;
}

/** Where to look a character up: the guild's version's namespace and region, and its name. */
export interface ArmoryQuery {
  /** The game version's namespace for the region (`profile-forever-eu`, see `armoryNamespaceFor`). */
  namespace: string;
  /** The guild's region (`EU`, `US`). */
  region: string;
  name: string;
  /** Empty for a version without last names. */
  lastName: string;
}

const REGIONS = ['eu', 'us', 'kr', 'tw'];

/**
 * Reads a public character from Blizzard's armory API. It needs a Battle.net developer client
 * (`BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET`) and no player login: the server gets its own
 * token (client credentials) and asks for the character, in the guild's region and its game
 * version's namespace (`armoryNamespace` in the game config). Blizzard's data can lag behind the
 * game (a new character can be missing for a while), so a failure is normal.
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

  async lookup(query: ArmoryQuery): Promise<ArmoryCharacter> {
    if (!this.configured) {
      throw new ArmoryError('not-configured', 'The armory is not set up on this server.');
    }
    const region = query.region.toLowerCase();
    if (!REGIONS.includes(region) || !/^[a-z0-9-]+$/.test(query.namespace)) {
      throw new ArmoryError('not-configured', 'This guild’s region has no armory.');
    }
    // The first name always; the last name when the version has them.
    const parts = [query.name.trim(), query.lastName.trim()].filter((part, i) => i === 0 || part);
    if (!parts.every((part) => CHARACTER_NAME.test(part))) {
      throw new ArmoryError('not-found', 'Type the character’s name first (letters only).');
    }
    const trimmed = parts.join(' ');
    // Forever's characters have no realm: they are addressed by `name-lastname`.
    const slug = parts.map((part) => encodeURIComponent(part.toLowerCase())).join('-');
    const url =
      `https://${region}.api.blizzard.com/profile/wow/character/${slug}` +
      `?namespace=${query.namespace}&locale=${region === 'us' ? 'en_US' : 'en_GB'}`;

    let response = await this.get(url, await this.accessToken());
    if (response.status === 401) {
      // The token was refused (revoked, or clocks): get a new one once.
      this.token = null;
      response = await this.get(url, await this.accessToken());
    }
    if (response.status === 404) {
      throw new ArmoryError(
        'not-found',
        `No character called ${trimmed} was found in the ${region.toUpperCase()} armory. It may be new, or its data may not have reached the armory yet.`,
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
      name: profile.name ? [profile.name, profile.surname].filter(Boolean).join(' ') : trimmed,
      class: characterClass.name,
      race: race.name,
      level,
      faction: faction?.name ?? '',
      // Forever has no realm: its rule set ("Roleplay") instead.
      realm: profile.realm?.name ?? profile.ruleset?.name ?? '',
      talents: await this.talents(url),
    };
  }

  /**
   * EXPERIMENTAL: the character's talent builds, from `<character url>/specializations`. Best
   * effort: without them the lookup still fills race, class and level (and the main spec is
   * assumed).
   */
  private async talents(characterUrl: string): Promise<TalentBuild[] | null> {
    const [path, query] = characterUrl.split('?');
    try {
      const response = await this.get(`${path}/specializations?${query}`, await this.accessToken());
      if (!response.ok) return null;
      return parseTalents((await response.json()) as SpecializationsResponse);
    } catch {
      return null;
    }
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
