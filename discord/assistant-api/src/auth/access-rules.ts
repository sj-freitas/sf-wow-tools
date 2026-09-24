/**
 * The permission rules, kept free of I/O so they are easy to test. See the
 * "Guilds and access levels" section of the README.
 */

export interface GuildAccessFlags {
  /** Holds the admin role (Guild-Assistant) in every one of the guild's servers. */
  isAdmin: boolean;
  /** Holds the guild's Officer role in its main server. */
  isOfficer: boolean;
}

/**
 * Whether the member holds a role with this name. Role names aren't unique in
 * Discord, so any role with the name counts, not just the first.
 */
export function holdsRoleNamed(
  serverRoles: { id: string; name: string }[],
  memberRoleIds: string[],
  roleName: string,
): boolean {
  return serverRoles.some((role) => role.name === roleName && memberRoleIds.includes(role.id));
}

/** Guild-Assistant of a guild = holds the role in *every* one of its servers. */
export function isGuildAssistant(
  guildServerIds: string[],
  serversWithRole: ReadonlySet<string>,
): boolean {
  return guildServerIds.every((id) => serversWithRole.has(id));
}

/** Officers configure the guild (details, servers, Officer role) and Guild-Assistants do too. */
export const canConfigureGuild = (access: GuildAccessFlags): boolean =>
  access.isAdmin || access.isOfficer;

/** Only Officers manage every player's characters. */
export const canManageAllCharacters = (access: GuildAccessFlags): boolean => access.isOfficer;

/**
 * Editing a character: Officers can edit any, every other member of the guild
 * only their own. `access` is null for people who aren't in the guild at all.
 */
export function canEditCharacter(
  access: GuildAccessFlags | null,
  characterOwnerDiscordId: string,
  userDiscordId: string,
): boolean {
  if (!access) {
    return false;
  }
  return canManageAllCharacters(access) || characterOwnerDiscordId === userDiscordId;
}
