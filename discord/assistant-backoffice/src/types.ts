export type Faction = 'ALLIANCE' | 'HORDE';
export type Role = 'HEALER' | 'TANK' | 'MELEE_DPS' | 'RANGED_DPS';

export interface Character {
  id: string;
  class: string;
  roles: Role[];
  firstName: string;
  lastName: string;
  isMain: boolean;
  level: number;
}

export interface Player {
  id: string;
  discordUserId: string;
  guildId: string;
  characters: Character[];
}

export interface User {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
}

export interface Guild {
  id: string;
  name: string;
  realm: string;
  faction: Faction;
  gameVersion: string;
  /** Holds the admin role in all of the guild's servers: can manage it. */
  isAdmin: boolean;
  servers: GuildServer[];
}

export interface GuildServer {
  discordId: string;
  name: string;
}

export interface EligibleServers {
  servers: GuildServer[];
}

export interface SetupInfo {
  adminRoleName: string;
  botInviteUrl: string;
}

// Keep in sync with assistant-api/src/game/game-version.ts.
export const GAME_VERSIONS = ['Forever'] as const;

export interface NewGuildInput {
  name: string;
  realm: string;
  faction: Faction;
  gameVersion: string;
  discordServerIds: string[];
}

// Keep in sync with assistant-api/src/game/wow-class.ts.
export const WOW_CLASSES = [
  'Druid',
  'Hunter',
  'Mage',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior',
] as const;

export const ROLE_LABELS: Record<Role, string> = {
  TANK: 'Tank',
  HEALER: 'Healer',
  MELEE_DPS: 'Melee DPS',
  RANGED_DPS: 'Ranged DPS',
};

export interface CharacterPatch {
  /** `Name` or `Name-Lastname`. */
  name?: string;
  class?: string;
  roles?: Role[];
  isMain?: boolean;
  level?: number;
}

export interface NewCharacterInput {
  discordUserId: string;
  /** `Name` or `Name-Lastname`. */
  name: string;
  class: string;
  roles: Role[];
  isMain: boolean;
  level?: number;
}
