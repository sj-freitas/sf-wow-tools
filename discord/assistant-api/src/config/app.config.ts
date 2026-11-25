/** App-wide settings that aren't secrets (those live in .env). */
export const APP_CONFIG = {
  /** Discord role whose holders (in every server of a guild) can create and configure guilds. */
  adminRoleName: 'Guild-Assistant',
  /** Permission integer in the bot invite link (the bot itself only needs to be in the server). */
  botInvitePermissions: '3960426119822455',
  /** Discord data (servers, roles) is re-synced when a session's copy is older than this. */
  discordSyncMaxAgeMs: 60 * 1000,
  /** A user-triggered ("force") re-sync is skipped if the last one was more recent than this. */
  discordForceSyncMinIntervalMs: 30 * 1000,
  /**
   * After a sync fails, how long ordinary requests leave Discord alone before trying again. It
   * doubles with each failure in a row, up to `discordSyncRetryMaxMs`. Without it every request
   * a minute later tried again, so a failure that lasted turned into a warning a minute, for
   * hours, and kept asking Discord the question it had just refused.
   */
  discordSyncRetryBaseMs: 2 * 60 * 1000,
  /** Where the doubling stops. */
  discordSyncRetryMaxMs: 30 * 60 * 1000,
  /** Guild ranks (from live Discord roles) are reused for this long, to spare Discord's rate limits. */
  ranksCacheMs: 60 * 1000,
} as const;
