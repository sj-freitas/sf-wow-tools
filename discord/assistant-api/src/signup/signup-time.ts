import { DateTime, FixedOffsetZone, IANAZone } from 'luxon';

/** "Server time": the timezone of the guild's region (Europe/Paris for EU, ...). */
export const SERVER_TIME = 'ST';

/**
 * The timezone an event's time is written in: `ST` (or nothing) for the guild's server time, an
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

/** `YYYY-MM-DD`. */
const DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
/** `HH:mm` (24h, `.` also accepted) or `h:mm am/pm` / `8pm`. */
const TIME_24 = /^(\d{1,2})[:.h](\d{2})$/i;
const TIME_12 = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?$/i;

/** Hours and minutes from a typed time, or null. */
export function parseTimeOfDay(input: string): { hour: number; minute: number } | null {
  const value = input.trim();
  const h24 = TIME_24.exec(value);
  if (h24) {
    const hour = Number(h24[1]);
    const minute = Number(h24[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }
  const h12 = TIME_12.exec(value);
  if (h12) {
    const hour = Number(h12[1]);
    const minute = Number(h12[2] ?? '0');
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const pm = h12[3].toLowerCase() === 'p';
    return { hour: (hour % 12) + (pm ? 12 : 0), minute };
  }
  return null;
}

/**
 * The moment a date and time mean in `zone`, or an explanation of what is wrong with them. A time
 * that doesn't exist that day (skipped by a daylight-saving change) is refused rather than moved.
 */
export function parseEventStart(date: string, time: string, zone: string): Date | string {
  const day = DATE.exec(date.trim());
  if (!day) return 'Write the date as YYYY-MM-DD, for example 2026-10-20.';
  const clock = parseTimeOfDay(time);
  if (!clock) return 'Write the time as HH:mm, for example 20:00.';
  const local = DateTime.fromObject(
    { year: Number(day[1]), month: Number(day[2]), day: Number(day[3]), ...clock },
    { zone },
  );
  if (!local.isValid) return `${date} is not a date.`;
  if (local.hour !== clock.hour || local.minute !== clock.minute) {
    return `${time} does not exist on ${date} in ${zone} (the clocks change that night).`;
  }
  return local.toJSDate();
}

/** Today's date in `zone`, as `YYYY-MM-DD`: an event's day when none is given. */
export const todayIn = (zone: string, now: Date = new Date()): string =>
  DateTime.fromJSDate(now, { zone }).toFormat('yyyy-MM-dd');

/**
 * The next full or half hour in `zone` (15:15 -> 15:30, 15:31 -> 16:00, 15:30 stays), as
 * `YYYY-MM-DD` and `HH:mm`: an event's start when no time is given. Late at night it is tomorrow.
 */
export function nextHalfHourIn(
  zone: string,
  now: Date = new Date(),
): { date: string; time: string } {
  const local = DateTime.fromJSDate(now, { zone }).startOf('minute');
  const minutesUp = (30 - (local.minute % 30)) % 30;
  const rounded = local.plus({ minutes: minutesUp });
  return { date: rounded.toFormat('yyyy-MM-dd'), time: rounded.toFormat('HH:mm') };
}

/** The date and time of a moment in `zone`, for the backoffice's date and time inputs. */
export function localParts(at: Date, zone: string): { date: string; time: string } {
  const local = DateTime.fromJSDate(at, { zone });
  return { date: local.toFormat('yyyy-MM-dd'), time: local.toFormat('HH:mm') };
}

/** Discord shows `<t:…>` in each reader's own timezone. */
export const discordTimestamp = (at: Date, style: 'F' | 'R' | 'f' | 't' = 'F'): string =>
  `<t:${Math.floor(at.getTime() / 1000)}:${style}>`;
