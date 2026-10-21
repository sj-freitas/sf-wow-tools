import { DateTime } from 'luxon';

// Shared with plugins and posts (src/config/timezones.ts); re-exported for sign-up code.
export { resolveTimezone, SERVER_TIME } from '../config/timezones';

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

/**
 * When invites start: `time` (HH:mm) on the event's day in `zone`, or the day before when that
 * would be after the start (invites at 23:45 for a raid at 00:30). An error message if it can't be.
 */
export function parseInviteTime(startsAt: Date, time: string, zone: string): Date | string {
  const clock = parseTimeOfDay(time);
  if (!clock) return 'Write the invite time as HH:mm, for example 19:45.';
  let invites = DateTime.fromJSDate(startsAt, { zone }).set({
    ...clock,
    second: 0,
    millisecond: 0,
  });
  if (invites.toMillis() >= startsAt.getTime()) invites = invites.minus({ days: 1 });
  if (invites.hour !== clock.hour || invites.minute !== clock.minute) {
    return `${time} does not exist that day in ${zone} (the clocks change that night).`;
  }
  return invites.toJSDate();
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
