/**
 * The one armory the "Load from armory" test feature reads: Season of Discovery on Wild Growth
 * (EU), through Blizzard's Classic Era API (`classic1x`; Season of Discovery shares it). The
 * Forever armory does not exist yet, so this is a stand-in. Later it should be picked from the
 * guild's region and game version, which is why it is all in one place.
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
