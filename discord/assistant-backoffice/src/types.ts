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
  discordUsername: string | null;
  discordDisplayName: string | null;
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
  servers: GuildServer[];
  /** Role in the main server whose holders can manage the guild. */
  officerRole: { id: string; name: string } | null;
  /** Holds the admin role in all servers: can also set the main server and Officer role. */
  isAdmin: boolean;
  isOfficer: boolean;
  /** isAdmin || isOfficer: can manage characters, servers and the guild. */
  canManage: boolean;
}

export interface GuildServer {
  discordId: string;
  name: string;
  isMain: boolean;
}

export interface GuildDetails {
  name: string;
  realm: string;
  faction: Faction;
  gameVersion: string;
}

export interface RoleOption {
  id: string;
  name: string;
}

export interface People {
  /** `known`: Discord refused to list server members, so only registered players. */
  source: 'servers' | 'known';
  people: Person[];
}

export interface Person {
  discordUserId: string;
  username: string | null;
  displayName: string | null;
  characterNames: string[];
}

export interface EligibleServers {
  servers: { discordId: string; name: string }[];
}

export interface SetupInfo {
  adminRoleName: string;
  botInviteUrl: string;
}

// Keep in sync with assistant-api/src/game/game-version.ts.
export const GAME_VERSIONS = ['Forever'] as const;

export interface NewGuildInput extends GuildDetails {
  discordServerIds: string[];
  mainServerId: string;
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
