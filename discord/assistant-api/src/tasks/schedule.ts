import { DateTime } from 'luxon';

export type ScheduleKind = 'ONCE' | 'DAILY' | 'WEEKLY';

/**
 * How a task repeats. ONCE runs at an instant; DAILY/WEEKLY run at a wall-clock time
 * (`HH:mm`, and an ISO weekday 1-7 for WEEKLY) in the guild's timezone, so they follow
 * daylight saving time.
 */
export interface Schedule {
  kind: ScheduleKind;
  runAt?: Date | null;
  timeOfDay?: string | null;
  weekday?: number | null;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Problems with a schedule, in plain language; empty when it is valid. */
export function validateSchedule(schedule: Schedule): string[] {
  const problems: string[] = [];
  if (schedule.kind === 'ONCE') {
    if (!schedule.runAt || Number.isNaN(schedule.runAt.getTime())) {
      problems.push('Pick the date and time to post.');
    }
    return problems;
  }
  if (!schedule.timeOfDay || !TIME_OF_DAY.test(schedule.timeOfDay)) {
    problems.push('The time must look like 20:00.');
  }
  if (schedule.kind === 'WEEKLY') {
    const day = schedule.weekday;
    if (!day || !Number.isInteger(day) || day < 1 || day > 7) {
      problems.push('Pick a day of the week.');
    }
  }
  return problems;
}

/** The first occurrence strictly after `after`, or null for a ONCE schedule that has passed. */
export function nextOccurrence(schedule: Schedule, timezone: string, after: Date): Date | null {
  if (schedule.kind === 'ONCE') {
    return schedule.runAt && schedule.runAt.getTime() > after.getTime() ? schedule.runAt : null;
  }
  const [hour, minute] = (schedule.timeOfDay ?? '00:00').split(':').map(Number);
  const local = DateTime.fromJSDate(after, { zone: timezone });
  let candidate = local.set({ hour, minute, second: 0, millisecond: 0 });
  if (schedule.kind === 'WEEKLY') {
    const daysAhead = ((((schedule.weekday ?? 1) - candidate.weekday) % 7) + 7) % 7;
    candidate = candidate.plus({ days: daysAhead });
  }
  if (candidate.toMillis() <= after.getTime()) {
    candidate = candidate.plus({ days: schedule.kind === 'WEEKLY' ? 7 : 1 });
  }
  return candidate.toJSDate();
}

/**
 * Occurrences strictly after `from` and up to `until` (inclusive), oldest first. Used to
 * record the occurrences a recurring task skipped while catching up. Capped for safety.
 */
export function occurrencesBetween(
  schedule: Schedule,
  timezone: string,
  from: Date,
  until: Date,
  limit = 100,
): Date[] {
  const found: Date[] = [];
  let cursor = from;
  while (found.length < limit) {
    const next = nextOccurrence(schedule, timezone, cursor);
    if (!next || next.getTime() > until.getTime()) break;
    found.push(next);
    cursor = next;
  }
  return found;
}

/** e.g. "Every Tuesday at 20:00", "Every day at 20:00", "Once on 2026-10-01 at 20:00". */
export function describeSchedule(schedule: Schedule, timezone: string): string {
  if (schedule.kind === 'ONCE' && schedule.runAt) {
    const local = DateTime.fromJSDate(schedule.runAt, { zone: timezone });
    return `Once on ${local.toFormat('yyyy-MM-dd')} at ${local.toFormat('HH:mm')}`;
  }
  if (schedule.kind === 'WEEKLY') {
    return `Every ${WEEKDAY_NAMES[(schedule.weekday ?? 1) - 1]} at ${schedule.timeOfDay}`;
  }
  return `Every day at ${schedule.timeOfDay}`;
}

/** Interprets a "yyyy-MM-ddTHH:mm" wall-clock time in the timezone as an instant. */
export function instantFromLocal(local: string, timezone: string): Date | null {
  const parsed = DateTime.fromISO(local, { zone: timezone });
  return parsed.isValid ? parsed.toJSDate() : null;
}
