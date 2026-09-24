export const GAME_VERSIONS = ['Forever'] as const;

export type GameVersion = (typeof GAME_VERSIONS)[number];

interface GameVersionRules {
  /** Characters must have a last name (`Name-Lastname`). */
  lastNameRequired: boolean;
}

const RULES: Record<GameVersion, GameVersionRules> = {
  Forever: { lastNameRequired: true },
};

const rulesOf = (gameVersion: string): GameVersionRules | undefined =>
  (RULES as Record<string, GameVersionRules | undefined>)[gameVersion];

export const requiresLastName = (gameVersion: string): boolean =>
  rulesOf(gameVersion)?.lastNameRequired ?? false;

export const lastNameRequiredMessage = (gameVersion: string): string =>
  `Characters in ${gameVersion} need a last name: use Name-Lastname (a dash between first and last name).`;
