export const GAME_VERSIONS = ['Forever'] as const;

export type GameVersion = (typeof GAME_VERSIONS)[number];
