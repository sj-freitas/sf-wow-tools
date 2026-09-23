/** App-wide settings that aren't secrets (those live in .env). */
export const APP_CONFIG = {
  /** Discord role that lets a member manage a guild in the backoffice. */
  adminRoleName: 'Guild-Assistant',
  /** Permission integer in the bot invite link (the bot itself only needs to be in the server). */
  botInvitePermissions: '3960426119822455',
  /** Discord data (servers, roles) is re-synced when a session's copy is older than this. */
  discordSyncMaxAgeMs: 5 * 60 * 1000,
} as const;
