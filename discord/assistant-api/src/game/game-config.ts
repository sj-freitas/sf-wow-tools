import { REGIONS, type RegionId } from '../config/regions';

/**
 * What a version of the game looks like. Each version lives in its own directory,
 * `src/game/<version>/`, with a `config.ts` that default-exports one of these (built with
 * `defineGame`, which makes TypeScript check the class names). The versions found there are the
 * ones a guild can be created for, and the whole config is sent to the backoffice so its forms
 * (guild details, character race and class) render from it. Volatile on purpose: expect it to grow
 * and to change shape.
 */

/** The roles a specialization can play; the same names the roster shows. */
export const GAME_ROLES = ['Tank', 'Healer', 'Melee DPS', 'Ranged DPS'] as const;
export type GameRole = (typeof GAME_ROLES)[number];

/** A specialization of a class. Still being defined: what is here is what is known so far. */
export interface SpecializationConfig {
  roles: readonly GameRole[];
  raidBuffs?: readonly string[];
  groupBuffs?: readonly string[];
}

export interface ClassConfig {
  /** By name. Empty until a version defines them. */
  specializations: Readonly<Record<string, SpecializationConfig>>;
}

/** A race, and the classes it can be (each one must be a key of the game's `classes`). */
export interface RaceConfig<C extends string = string> {
  classes: readonly C[];
}

export interface FactionConfig<C extends string = string> {
  /** By name. */
  races: Readonly<Record<string, RaceConfig<C>>>;
}

export interface GameRules {
  /** Characters must have a last name (`Name-Lastname`). */
  lastNameRequired: boolean;
}

export interface GameConfig<C extends string = string> {
  /** The name of the version, as guilds store it ("Forever"). Unique across versions. */
  gameVersion: string;
  rules: GameRules;
  /**
   * The servers a guild of this version can be on, per region (the regions of `config/regions.ts`).
   * A region with no entry is not available for this version.
   */
  allowedServers: Readonly<Partial<Record<RegionId, readonly string[]>>>;
  /** Every class of the game, by name. */
  classes: Readonly<Record<C, ClassConfig>>;
  /** By name ("Alliance", "Horde"). */
  factions: Readonly<Record<string, FactionConfig<C>>>;
}

/**
 * Writes a version's config with the classes checked: a race can only list classes that are keys
 * of `classes` (a typo is a compile error). The class names are taken from `classes` alone.
 */
export const defineGame = <const C extends string>(
  config: Omit<GameConfig<C>, 'factions'> & {
    factions: Readonly<Record<string, FactionConfig<NoInfer<C>>>>;
  },
): GameConfig<C> => config;

/**
 * Checks a config that was loaded at run time (what `defineGame` cannot see: the files are found
 * by scanning directories). Returns what is wrong, empty when it is fine.
 */
export function gameConfigProblems(config: unknown): string[] {
  const problems: string[] = [];
  const game = config as Partial<GameConfig> | null;
  if (!game || typeof game !== 'object') return ['it does not export a config object'];

  if (typeof game.gameVersion !== 'string' || game.gameVersion.trim() === '') {
    problems.push('gameVersion must be a name');
  }
  if (typeof game.rules?.lastNameRequired !== 'boolean') {
    problems.push('rules.lastNameRequired must be true or false');
  }

  const servers = game.allowedServers;
  if (!servers || typeof servers !== 'object') {
    problems.push('allowedServers is missing');
  } else {
    for (const [region, list] of Object.entries(servers)) {
      if (!Object.hasOwn(REGIONS, region)) {
        problems.push(
          `allowedServers has "${region}", which is not a region (${Object.keys(REGIONS).join(', ')})`,
        );
      }
      if (
        !Array.isArray(list) ||
        list.length === 0 ||
        list.some((s) => typeof s !== 'string' || s === '')
      ) {
        problems.push(`allowedServers.${region} must be a list of server names`);
      }
    }
    if (Object.keys(servers).length === 0)
      problems.push('allowedServers needs at least one region');
  }

  const classes = game.classes;
  const classNames = classes && typeof classes === 'object' ? Object.keys(classes) : [];
  if (classNames.length === 0) problems.push('classes needs at least one class');
  for (const [name, entry] of Object.entries(classes ?? {})) {
    const specializations = (entry as ClassConfig | undefined)?.specializations;
    if (!specializations || typeof specializations !== 'object') {
      problems.push(`classes.${name}.specializations is missing (use {} when there are none yet)`);
      continue;
    }
    for (const [spec, details] of Object.entries(specializations)) {
      const roles = (details as SpecializationConfig | undefined)?.roles;
      if (
        !Array.isArray(roles) ||
        roles.length === 0 ||
        roles.some((r: unknown) => !(GAME_ROLES as readonly unknown[]).includes(r))
      ) {
        problems.push(
          `classes.${name}.specializations.${spec}.roles must list ${GAME_ROLES.join(', ')}`,
        );
      }
    }
  }

  const factions = game.factions;
  if (!factions || typeof factions !== 'object' || Object.keys(factions).length === 0) {
    problems.push('factions needs at least one faction');
  }
  for (const [faction, factionConfig] of Object.entries(factions ?? {})) {
    const races = (factionConfig as FactionConfig | undefined)?.races;
    if (!races || typeof races !== 'object' || Object.keys(races).length === 0) {
      problems.push(`factions.${faction}.races needs at least one race`);
      continue;
    }
    for (const [race, raceConfig] of Object.entries(races)) {
      const list = raceConfig?.classes;
      if (!Array.isArray(list) || list.length === 0) {
        problems.push(`${faction} ${race} needs at least one class`);
        continue;
      }
      for (const className of list) {
        if (!classNames.includes(className as string)) {
          problems.push(
            `${faction} ${race} lists the class "${className}", which is not in classes`,
          );
        }
      }
      if (new Set(list).size !== list.length)
        problems.push(`${faction} ${race} lists a class twice`);
    }
  }
  return problems;
}
