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
  faction: Faction;
  realm: string;
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
  /** Holds the Guild-Assistant role: can manage this guild's characters. */
  isAdmin: boolean;
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

export interface NewCharacterInput {
  discordUserId: string;
  /** `Name` or `Name-Lastname`. */
  name: string;
  class: string;
  roles: Role[];
  isMain: boolean;
  level?: number;
}
