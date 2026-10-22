/**
 * What the bot may do in a channel, worked out the way Discord does it (no I/O here, so it is easy
 * to test): the server's @everyone role and the bot's roles, then the channel's overwrites
 * (@everyone, the bot's roles, the bot itself). Administrator allows everything.
 */

export const PERMISSIONS = {
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  READ_MESSAGE_HISTORY: 1n << 16n,
} as const;

export type PermissionName = keyof typeof PERMISSIONS;

/** As Discord's settings name them, for officers. */
export const PERMISSION_LABELS: Record<PermissionName, string> = {
  BAN_MEMBERS: 'Ban Members',
  ADMINISTRATOR: 'Administrator',
  MANAGE_CHANNELS: 'Manage Channels',
  ADD_REACTIONS: 'Add Reactions',
  VIEW_CHANNEL: 'View Channel',
  SEND_MESSAGES: 'Send Messages',
  MANAGE_MESSAGES: 'Manage Messages',
  EMBED_LINKS: 'Embed Links',
  READ_MESSAGE_HISTORY: 'Read Message History',
};

/** What a channel is used for, and what the bot needs there for it. */
export type ChannelUse = 'post' | 'cleanup' | 'recurring' | 'honeypot';

export const REQUIRED: Record<ChannelUse, PermissionName[]> = {
  // Posts and events: send, embed (events are embeds), react (seed reactions), read back.
  post: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS', 'ADD_REACTIONS', 'READ_MESSAGE_HISTORY'],
  // Channel Cleanup: read the messages and delete them.
  cleanup: ['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY', 'MANAGE_MESSAGES'],
  // Recurring Event: empties its channel, then posts the event.
  recurring: [
    'VIEW_CHANNEL',
    'SEND_MESSAGES',
    'EMBED_LINKS',
    'ADD_REACTIONS',
    'READ_MESSAGE_HISTORY',
    'MANAGE_MESSAGES',
  ],
  // A honeypot: see who posts, and ban them.
  honeypot: ['VIEW_CHANNEL', 'BAN_MEMBERS'],
};

export interface Overwrite {
  id: string;
  /** 0: a role, 1: a member. */
  type: number;
  allow: bigint;
  deny: bigint;
}

export interface PermissionInputs {
  /** The server's id: its @everyone role has the same id. */
  serverId: string;
  /** The bot's user id, and the roles it has in the server. */
  memberId: string;
  memberRoleIds: readonly string[];
  /** Every role of the server and its permissions. */
  roles: readonly { id: string; permissions: bigint }[];
  overwrites: readonly Overwrite[];
}

const ALL = (1n << 53n) - 1n;

/** The bot's permissions in the channel. */
export function channelPermissions(inputs: PermissionInputs): bigint {
  const { serverId, memberId, memberRoleIds, roles, overwrites } = inputs;
  const roleOf = (id: string) => roles.find((role) => role.id === id)?.permissions ?? 0n;
  let permissions = roleOf(serverId);
  for (const id of memberRoleIds) permissions |= roleOf(id);
  if (permissions & PERMISSIONS.ADMINISTRATOR) return ALL;

  const everyone = overwrites.find((o) => o.id === serverId);
  if (everyone) permissions = (permissions & ~everyone.deny) | everyone.allow;
  let allow = 0n;
  let deny = 0n;
  for (const o of overwrites) {
    if (o.type === 0 && o.id !== serverId && memberRoleIds.includes(o.id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  permissions = (permissions & ~deny) | allow;
  const member = overwrites.find((o) => o.type === 1 && o.id === memberId);
  if (member) permissions = (permissions & ~member.deny) | member.allow;
  return permissions;
}

/** The permissions `use` needs that `permissions` lacks, by name. */
export function missingFor(use: ChannelUse, permissions: bigint): PermissionName[] {
  return REQUIRED[use].filter((name) => (permissions & PERMISSIONS[name]) === 0n);
}
