/** App-wide settings that aren't secrets (those live in .env). */
export const APP_CONFIG = {
  /** Discord role that lets a member manage a guild in the backoffice. */
  adminRoleName: 'Guild-Assistant',
} as const;
