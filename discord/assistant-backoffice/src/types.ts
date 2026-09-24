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
  /** Role in the main server whose holders manage the guild's characters and settings. */
  officerRole: { id: string; name: string } | null;
  /** Optional roles in the main server standing for Raider and Social, for roster setup. */
  roleMappings: Record<GuildRoleKey, { id: string; name: string } | null>;
  /** Holds the admin role in all servers: configures the guild (details, servers, Officer role). */
  isAdmin: boolean;
  /** Holds the Officer role in the main server: manages every player's characters. */
  isOfficer: boolean;
}

export type GuildRoleKey = 'RAIDER' | 'SOCIAL';

/** Discord user id -> ranks (Officer, Raider, Social) they hold as Discord roles. */
export type Ranks = Record<string, string[]>;

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

export const requiresLastName = (gameVersion: string): boolean => gameVersion === 'Forever';

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
  /** Officers only: add for someone else. Omitted = the logged-in user. */
  discordUserId?: string;
  /** `Name` or `Name-Lastname`. */
  name: string;
  class: string;
  roles: Role[];
  isMain: boolean;
  level?: number;
}
