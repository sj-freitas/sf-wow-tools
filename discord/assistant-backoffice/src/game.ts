import { createContext, useContext } from 'react';
import { ROLE_LABELS, type Faction, type GameConfig, type Role } from './types';

/** The game versions the API knows, provided once for every form that needs them. */
export const GamesContext = createContext<GameConfig[]>([]);
/** TEST: the armory the character form can load from (null when it is not set up). */
export const ArmoryContext = createContext<{ description: string } | null>(null);
export const useArmory = (): { description: string } | null => useContext(ArmoryContext);

export const useGames = (): GameConfig[] => useContext(GamesContext);

export const gameOf = (games: readonly GameConfig[], gameVersion: string): GameConfig | undefined =>
  games.find((game) => game.gameVersion === gameVersion);

/** Characters must have a last name in this version. */
export const requiresLastName = (games: readonly GameConfig[], gameVersion: string): boolean =>
  gameOf(games, gameVersion)?.rules.lastNameRequired ?? false;

/** The factions of a version as the API stores them (ALLIANCE, HORDE) with their names. */
export const factionsOf = (game: GameConfig | undefined): { id: Faction; label: string }[] =>
  Object.keys(game?.factions ?? {}).map((label) => ({
    id: label.toUpperCase() as Faction,
    label,
  }));

/**
 * The roles a class can play in a version: those of its specializations. Empty when the version does
 * not define any for the class yet, which means nothing is known and every role is allowed.
 */
export function rolesOfClass(game: GameConfig | undefined, className: string): Role[] {
  const specializations = Object.values(game?.classes[className]?.specializations ?? {});
  const names = new Set(specializations.flatMap((spec) => spec.roles));
  return (Object.keys(ROLE_LABELS) as Role[]).filter((role) => names.has(ROLE_LABELS[role]));
}

/** Every class of a version, by name. */
export const classNamesOf = (game: GameConfig | undefined): string[] =>
  Object.keys(game?.classes ?? {});

/** The servers a guild of a version can be on in a region. */
export const serversFor = (game: GameConfig | undefined, region: string): string[] =>
  game?.allowedServers[region] ?? [];

/** The regions (ids) a version is available in. */
export const regionsOf = (game: GameConfig | undefined): string[] =>
  Object.keys(game?.allowedServers ?? {});

/** The races of a version's faction, with the classes each can be. */
export function racesOf(
  game: GameConfig | undefined,
  faction: Faction,
): { race: string; classes: string[] }[] {
  const entry = Object.entries(game?.factions ?? {}).find(
    ([name]) => name.toUpperCase() === faction,
  );
  return Object.entries(entry?.[1].races ?? {}).map(([race, { classes }]) => ({ race, classes }));
}
