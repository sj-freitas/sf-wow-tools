import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RegionId } from '../config/regions';
import { gameConfigProblems, type GameConfig } from './game-config';

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

/** Whether any version of the game has this class. */
export const isWowClass = (value: string): boolean =>
  games().some((game) => Object.hasOwn(game.classes, value));

/** The servers a guild of this version can be on in a region (empty when it is not available there). */
export const serversOf = (gameVersion: string, region: RegionId): readonly string[] =>
  getGame(gameVersion)?.allowedServers[region] ?? [];

/** Characters must have a last name (`Name-Lastname`) in this version. */
export const requiresLastName = (gameVersion: string): boolean =>
  getGame(gameVersion)?.rules.lastNameRequired ?? false;

export const lastNameRequiredMessage = (gameVersion: string): string =>
  `Characters in ${gameVersion} need a last name: use Name-Lastname (a dash between first and last name).`;
