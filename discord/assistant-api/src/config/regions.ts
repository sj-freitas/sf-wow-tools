/**
 * The regions a guild can belong to. A region decides the timezone that the guild's
 * schedules (scheduled posts, ...) are interpreted in. To support another region, add it
 * here with an IANA timezone; nothing else needs to change.
 */
export const REGIONS = {
  EU: { label: 'Europe', timezone: 'Europe/Paris' },
  US: { label: 'United States', timezone: 'America/Los_Angeles' },
} as const;

export type RegionId = keyof typeof REGIONS;

export const DEFAULT_REGION: RegionId = 'EU';

export const isRegion = (value: unknown): value is RegionId =>
  typeof value === 'string' && Object.hasOwn(REGIONS, value);

/** The timezone of a region id as stored on a guild; unknown ids fall back to the default region. */
export const timezoneOfRegion = (region: string): string =>
  isRegion(region) ? REGIONS[region].timezone : REGIONS[DEFAULT_REGION].timezone;

export const regionOptions = () =>
  (Object.keys(REGIONS) as RegionId[]).map((id) => ({ id, ...REGIONS[id] }));
