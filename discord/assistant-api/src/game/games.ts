import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Faction } from '@prisma/client';
import type { RegionId } from '../config/regions';
import {
  GAME_ROLES,
  gameConfigProblems,
  type GameConfig,
  type GameRole,
  type ServerConfig,
} from './game-config';

/**
 * The versions of the game, found by looking at the directories next to this file: every
 * `src/game/<version>/` with a `config.ts` (a `config.js` once built) that default-exports a game
 * config is a version. Adding a version is adding a directory; nothing else lists them.
 */
export function loadGames(root: string = __dirname): GameConfig[] {
  const games: GameConfig[] = [];
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) {
    // Only a directory with a config is a version; others may hold shared code.
    if (!['config.ts', 'config.js'].some((file) => existsSync(join(root, directory, file)))) {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(join(root, directory, 'config')) as { default?: unknown };
    const problems = gameConfigProblems(loaded.default);
    if (problems.length > 0) {
      throw new Error(`The game config in "${directory}" is not valid: ${problems.join('; ')}.`);
    }
    const game = loaded.default as GameConfig;
    if (games.some((other) => other.gameVersion === game.gameVersion)) {
      throw new Error(
        `Two game configs are for "${game.gameVersion}" ("${directory}" is the second).`,
      );
    }
    games.push(game);
  }
  if (games.length === 0) throw new Error(`No game config was found in ${root}.`);
  return games;
}

let loaded: GameConfig[] | null = null;

/** Every version of the game, loaded once. */
export const games = (): readonly GameConfig[] => (loaded ??= loadGames());

export const gameVersions = (): string[] => games().map((game) => game.gameVersion);

export const getGame = (gameVersion: string): GameConfig | undefined =>
  games().find((game) => game.gameVersion === gameVersion);

export const isGameVersion = (value: unknown): value is string =>
  typeof value === 'string' && getGame(value) !== undefined;

/** The classes of a version (empty for an unknown one). */
export const classesOf = (gameVersion: string): string[] =>
  Object.keys(getGame(gameVersion)?.classes ?? {});

/**
 * The roles a class can play in a version: those of its specializations. Empty when the version
 * has not defined any specialization for the class yet (or does not have the class), which means
 * nothing is known and every role is allowed.
 */
export function rolesOfClass(gameVersion: string, characterClass: string): GameRole[] {
  const specializations = getGame(gameVersion)?.classes[characterClass]?.specializations ?? {};
  const roles = new Set(Object.values(specializations).flatMap((spec) => spec.roles));
  return GAME_ROLES.filter((role) => roles.has(role));
}

/** Whether any version of the game has this class. */
export const isWowClass = (value: string): boolean =>
  games().some((game) => Object.hasOwn(game.classes, value));

/** Whether any version of the game has this race, in any faction. */
export const isWowRace = (value: string): boolean =>
  games().some((game) =>
    Object.values(game.factions).some((faction) => Object.hasOwn(faction.races, value)),
  );

/** A race of a version's faction, and the classes it can be. */
export interface RaceOption {
  race: string;
  classes: string[];
}

/**
 * The races of a version's faction, with the classes each can be (empty for a version or faction
 * we know nothing of, which means nothing is restricted).
 */
export function racesOf(gameVersion: string, faction: Faction): RaceOption[] {
  const factions = getGame(gameVersion)?.factions ?? {};
  const entry = Object.entries(factions).find(([name]) => name.toUpperCase() === faction);
  return Object.entries(entry?.[1].races ?? {}).map(([race, { classes }]) => ({
    race,
    classes: [...classes],
  }));
}

/** Whether a race exists in the guild's faction for this version (a version/faction we know nothing of accepts any). */
export const raceInFaction = (gameVersion: string, faction: Faction, race: string): boolean => {
  const races = racesOf(gameVersion, faction);
  return races.length === 0 || races.some((entry) => entry.race === race);
};

/**
 * The classes a race can be, in this version's faction; null when we know nothing of the version
 * or faction (so any class fits).
 */
export function classesOfRace(
  gameVersion: string,
  faction: Faction,
  race: string,
): string[] | null {
  const races = racesOf(gameVersion, faction);
  if (races.length === 0) return null;
  return races.find((entry) => entry.race === race)?.classes ?? [];
}

/** The servers a guild of this version can be on in a region (empty when it is not available there). */
export const serversOf = (gameVersion: string, region: RegionId): readonly string[] =>
  Object.keys(getGame(gameVersion)?.allowedServers[region] ?? {});

/** A server, with the exact casing it is stored as (guilds, characters: `gameVersion`/`region`/`realm`). */
export interface ServerId {
  gameVersion: string;
  region: string;
  realm: string;
}

/**
 * Resolves a server from URL segments of any case (a character's page is addressed by its server,
 * lower case in the address, e.g. `/forever/eu/rp/characters/…`) to the exact casing it is stored
 * as. Undefined when no such server exists.
 */
export function resolveServer(
  urlVersion: string,
  urlRegion: string,
  urlRealm: string,
): ServerId | undefined {
  const gameVersion = gameVersions().find(
    (version) => version.toLowerCase() === urlVersion.toLowerCase(),
  );
  if (!gameVersion) return undefined;
  const allowedServers = getGame(gameVersion)?.allowedServers ?? {};
  const region = Object.keys(allowedServers).find(
    (id) => id.toLowerCase() === urlRegion.toLowerCase(),
  );
  if (!region) return undefined;
  const realm = serversOf(gameVersion, region as RegionId).find(
    (server) => server.toLowerCase() === urlRealm.toLowerCase(),
  );
  if (!realm) return undefined;
  return { gameVersion, region, realm };
}

/**
 * The rule set a server enforces (e.g. `'RP'`, `'PVP'`), or undefined if we don't know it. Takes
 * a plain region string (a guild's stored `region` is one, not always narrowed to `RegionId`).
 */
export const ruleSetOf = (
  gameVersion: string,
  region: string,
  server: string,
): string | undefined => {
  const byRegion: Record<string, Readonly<Record<string, ServerConfig>>> | undefined =
    getGame(gameVersion)?.allowedServers;
  return byRegion?.[region]?.[server]?.ruleSet;
};

/** Bios are an RP (roleplay) feature: only guilds on an `'RP'` rule-set server get them. */
export const supportsBios = (gameVersion: string, region: string, server: string): boolean =>
  ruleSetOf(gameVersion, region, server) === 'RP';

/** Characters must have a last name (`Name-Lastname`) in this version. */
export const requiresLastName = (gameVersion: string): boolean =>
  getGame(gameVersion)?.requiresLastName ?? false;

/** Everything an armory link template can use. */
export interface ArmoryLinkValues {
  name: string;
  lastName: string;
  /** The guild's region id, like `EU`. */
  region: string;
  /** The guild's server, like `PVE`. */
  server: string;
}

const slug = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The armory page of a character in a version, from its `armoryLink` template; null when the
 * version has none. Each value is made safe for an address (`{name}` keeps its accents, encoded).
 */
export function armoryLinkFor(gameVersion: string, values: ArmoryLinkValues): string | null {
  const template = getGame(gameVersion)?.armoryLink;
  if (!template) return null;
  const replacements: Record<string, string> = {
    name: encodeURIComponent(values.name),
    lastName: encodeURIComponent(values.lastName),
    region: slug(values.region),
    server: slug(values.server),
  };
  return template.replace(
    /\{(name|lastName|region|server)\}/g,
    (_match, key: string) => replacements[key],
  );
}

export const lastNameRequiredMessage = (gameVersion: string): string =>
  `Characters in ${gameVersion} need a last name: use Name-Lastname (a dash between first and last name).`;
