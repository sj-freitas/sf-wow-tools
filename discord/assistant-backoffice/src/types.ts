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
  region: string;
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

/** The guild's optional welcome post. */
export interface GuildHome {
  /** Markdown, or null when none has been written. */
  markdown: string | null;
  updatedAt: string | null;
  /** Username of the Officer who last edited it. */
  updatedBy: string | null;
}

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
  region: string;
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

export interface Region {
  id: string;
  label: string;
  /** IANA timezone the guild's schedules run in. */
  timezone: string;
}

export interface SetupInfo {
  adminRoleName: string;
  botInviteUrl: string;
  regions: Region[];
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

// ---- scheduled tasks and honeypots ----

export type TaskRunStatus = 'SUCCESS' | 'FAILED' | 'MISSED';

export interface ScheduledPost {
  id: string;
  name: string;
  type: 'POST';
  enabled: boolean;
  schedule: {
    /** When the post goes out. */
    runAt: string | null;
    /** For datetime-local inputs: the same moment in the guild's timezone. */
    runAtLocal: string | null;
    description: string;
  };
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: TaskRunStatus | null;
  lastError: string | null;
  post: {
    serverId: string;
    channelId: string;
    content: string;
    seedReactions: string[];
    posted: { messageId: string; url: string; postedAt: string; messageDeleted: boolean } | null;
  };
}

export interface PostInput {
  name: string;
  enabled?: boolean;
  /** When to post, in the guild's timezone ("yyyy-MM-ddTHH:mm"). */
  runAtLocal?: string;
  /** Post right away instead of at a date. */
  postNow?: boolean;
  serverId: string;
  channelId: string;
  content: string;
  seedReactions: string[];
}

/** One page of the guild's posts. */
export interface PostsPage {
  items: ScheduledPost[];
  /** All posts matching the search, over every page. */
  total: number;
  page: number;
  pageSize: number;
}

export interface ServerChannels {
  serverId: string;
  serverName: string;
  channels: { id: string; name: string }[];
  /** Why the channels could not be read (e.g. the bot is not in the server). */
  error: string | null;
}

export interface Reaction {
  emoji: string;
  emojiId: string | null;
  count: number;
  imageUrl: string | null;
}

export type HoneypotAction = 'WOULD_BAN' | 'BANNED' | 'FAILED';

export interface HoneypotEvent {
  id: string;
  discordUserId: string;
  username: string | null;
  action: HoneypotAction;
  error: string | null;
  at: string;
}

export interface Honeypot {
  id: string;
  name: string;
  enabled: boolean;
  /** Test mode only logs what would happen; nobody is banned. */
  testMode: boolean;
  serverId: string;
  channelId: string;
  logChannelId: string;
  createdChannel: boolean;
  recentEvents: HoneypotEvent[];
}

export interface HoneypotInput {
  name: string;
  testMode: boolean;
  confirmLive: boolean;
  serverId: string;
  channelId?: string;
  newChannelName?: string;
  topic?: string;
  initialPost?: string;
  logServerId: string;
  logChannelId: string;
}
