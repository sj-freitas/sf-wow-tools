/**
 * The one server "Verify with Battle.net" (TEST) reads a player's characters from: Season of
 * Discovery on Wild Growth (EU), through Blizzard's Classic Era API (`classic1x`). A stand-in from
 * before Forever had an armory. "Load from armory" no longer uses it: it asks the guild's version's
 * armory (`armoryNamespace` in the game config).
 */
export const TEST_ARMORY = {
  region: 'eu',
  realmSlug: 'wild-growth',
  realmName: 'Wild Growth',
  namespace: 'profile-classic1x-eu',
  locale: 'en_GB',
  /** Shown next to the button. */
  description: 'EU · Classic Season of Discovery · Wild Growth',
} as const;
