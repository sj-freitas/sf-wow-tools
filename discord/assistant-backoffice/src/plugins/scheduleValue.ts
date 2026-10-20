import type { Plugin, PluginInput, PluginScheduleKind } from './pluginsApi';

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

/** A plugin's schedule as its form edits it. */
export interface ScheduleValue {
  frequency: PluginScheduleKind;
  timeOfDay: string;
  /** ISO weekday 1 (Monday) to 7. */
  weekday: number;
  dayOfMonth: number;
}

export const scheduleOf = (plugin: Plugin): ScheduleValue => ({
  frequency: plugin.schedule.kind,
  timeOfDay: plugin.schedule.timeOfDay,
  weekday: plugin.schedule.weekday ?? 1,
  dayOfMonth: plugin.schedule.dayOfMonth ?? 1,
});

/** What the API takes for it. */
export const scheduleInput = (value: ScheduleValue): PluginInput => ({
  scheduleKind: value.frequency,
  timeOfDay: value.timeOfDay,
  weekday: value.frequency === 'WEEKLY' ? value.weekday : null,
  dayOfMonth: value.frequency === 'MONTHLY' ? value.dayOfMonth : null,
});

/** "every Wednesday at 23:00". */
export const describeSchedule = (value: ScheduleValue): string =>
  value.frequency === 'DAILY'
    ? `every day at ${value.timeOfDay}`
    : value.frequency === 'WEEKLY'
      ? `every ${WEEKDAYS[value.weekday - 1]} at ${value.timeOfDay}`
      : `every month on day ${value.dayOfMonth} at ${value.timeOfDay}`;
