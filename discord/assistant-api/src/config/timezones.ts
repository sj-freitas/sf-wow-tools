import { FixedOffsetZone, IANAZone } from 'luxon';

/** "Server time": the timezone of the guild's region (Europe/Paris for EU, ...). */
export const SERVER_TIME = 'ST';

/**
 * The timezone a time is written in (events, plugins, posts): `ST` (or nothing) for the guild's server time, an
 * IANA name like `Europe/Lisbon` (any casing), `UTC`, or an offset like `+02:00` / `UTC-5`.
 * Returns the zone as stored (an IANA name, or `UTC+2`-style for offsets), or null if unknown.
 */
export function resolveTimezone(input: string | undefined, serverTimezone: string): string | null {
  const value = (input ?? '').trim();
  if (value === '' || value.toUpperCase() === SERVER_TIME) return serverTimezone;
  if (/^(utc|gmt|z)$/i.test(value)) return 'UTC';

  const offset = /^(?:utc|gmt)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(value);
  if (offset) {
    const [, sign, hours, minutes = '00'] = offset;
    if (Number(hours) > 14 || Number(minutes) > 59) return null;
    const zone = FixedOffsetZone.parseSpecifier(
      `UTC${sign}${Number(hours)}${minutes === '00' ? '' : `:${minutes}`}`,
    );
    return zone?.isValid ? zone.name : null;
  }

  if (!IANAZone.isValidZone(value)) return null;
  // The canonical spelling ("europe/lisbon" -> "Europe/Lisbon").
  return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
}
