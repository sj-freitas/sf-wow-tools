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
  /** The Discord display name (the username when the account has none). */
  displayName: string;
  avatar: string | null;
}

export interface Guild {
  id: string;
  /** The guild's address: `<version>/<region>/<server>/<guild-name>`. */
  path: string;
  name: string;
  realm: string;
  faction: Faction;
  gameVersion: string;
  region: string;
  servers: GuildServer[];
  /** Changes with the banner image; null when the guild has no banner. */
  bannerVersion: number | null;
  /** Where members' messages to the officers are posted; null until set. */
  officerRequestChannel: { serverId: string; channelId: string } | null;
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
  /** Discord icon hash; null when the server has none. */
  icon: string | null;
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
  /** The versions of the game the API knows (src/game/<version>/config.ts). */
  games: GameConfig[];
  /** TEST: the armory the character form can load from; null when it is not set up. */
  armoryTest: { description: string } | null;
}

/** A character as the armory describes it (TEST). */
export interface ArmoryCharacter {
  name: string;
  class: string;
  race: string;
  level: number;
  faction: string;
  realm: string;
}

/** A specialization of a class (still being defined). */
export interface SpecializationConfig {
  roles: string[];
  raidBuffs?: string[];
  groupBuffs?: string[];
}

/** One version of the game, as the API sends it: what the guild and character forms render from. */
export interface GameConfig {
  gameVersion: string;
  rules: { lastNameRequired: boolean };
  /** Servers a guild can be on, per region id; a region that is missing is not available. */
  allowedServers: Record<string, string[]>;
  /** Every class, by name. */
  classes: Record<string, { specializations: Record<string, SpecializationConfig> }>;
  /** By name ("Alliance", "Horde"), each with its races and the classes they can be. */
  factions: Record<string, { races: Record<string, { classes: string[] }> }>;
}

export interface NewGuildInput extends GuildDetails {
  discordServerIds: string[];
  mainServerId: string;
}

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
    /** The messages of the post, in the order they are sent. */
    parts: PostPart[];
    /** Some message of the post is in Discord. */
    live: boolean;
    /** Every message of the post is in Discord. */
    complete: boolean;
    /** It was in Discord and every message was deleted. */
    wasDeleted: boolean;
  };
}

/** One message of a post. */
export interface PostPart {
  id: string;
  content: string;
  seedReactions: string[];
  /** Whether Discord shows link previews under the message. */
  embedLinks: boolean;
  /** Seconds waited after the previous message before this one is sent. */
  delaySeconds: number;
  /** Uploaded images shown under the text (see `postImageUrl`). */
  imageIds: string[];
  /** The message in Discord; null when it is not there. */
  posted: { messageId: string; url: string; postedAt: string } | null;
}

/** What is sent to save one message of a post. */
export interface PostPartInput {
  /** Kept when editing, so the message keeps its place in Discord. */
  id?: string;
  content: string;
  seedReactions: string[];
  embedLinks: boolean;
  delaySeconds: number;
  imageIds: string[];
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
  parts: PostPartInput[];
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

// ---- officer requests (members writing to the officers with /contact-officer) ----

export interface ConversationSummary {
  /** The 8-digit conversation id. */
  publicId: number;
  isAnonymous: boolean;
  /** The member's name; null for an anonymous conversation. */
  requesterName: string | null;
  preview: string;
  messageCount: number;
  createdAt: string;
  lastActivityAt: string;
  /** The member wrote last: no officer has answered yet. */
  awaitingReply: boolean;
  locked: boolean;
}

export interface ConversationsPage {
  items: ConversationSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConversationMessage {
  id: string;
  author: 'USER' | 'OFFICER';
  /** Member messages: their name, only if not anonymous. Officer messages: the officer's name. */
  authorName: string | null;
  officerDiscordId: string | null;
  content: string;
  createdAt: string;
  /** Officer replies: whether the DM reached the member. */
  dmDelivered: boolean | null;
  /** The message has a picture: see `officerMessageImageUrl`. */
  hasImage: boolean;
}

export interface Conversation {
  publicId: number;
  isAnonymous: boolean;
  requester: { name: string; discordId: string } | null;
  createdAt: string;
  locked: boolean;
  messages: ConversationMessage[];
}
