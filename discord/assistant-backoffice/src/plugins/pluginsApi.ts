import { request } from '../api';

/** Plugins (API: /api/guilds/:guildId/plugins, /api/plugins/:id). */

export type PluginKind = 'CHANNEL_CLEANUP' | 'RECURRING_EVENT' | 'PROFESSIONS_POST';
/** HOURLY (on the hour) and EVERY_5_MINUTES: for plugins whose runs are cheap checks. */
export type PluginScheduleKind = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'HOURLY' | 'EVERY_5_MINUTES';
export type PluginRunStatus = 'SUCCESS' | 'FAILED' | 'MISSED';

/** A kind of plugin there is to add (the API's plugin-kinds.ts). */
export interface PluginKindInfo {
  kind: PluginKind;
  label: string;
  description: string;
}

export interface PluginSchedule {
  kind: PluginScheduleKind;
  /** "HH:mm" in the guild's timezone. */
  timeOfDay: string;
  /** ISO weekday 1 (Monday) to 7, for WEEKLY. */
  weekday: number | null;
  /** 1-31 for MONTHLY; a shorter month runs on its last day. */
  dayOfMonth: number | null;
}

export interface ChannelCleanupConfig {
  serverId: string;
  channelId: string;
  keepBotMessages: boolean;
}

/** Recurring Event (event sign-ups' kind, its form is in ../signup): the event it posts. */
export interface RecurringEventConfig {
  serverId: string;
  channelId: string;
  kind: 'CHARACTERS' | 'MEMBERS';
  title: string;
  description: string;
  location: string;
  /** The event's day (ISO weekday 1-7) and "HH:mm": it starts on the next one after each run. */
  weekday: number;
  time: string;
  /** `ST` (server time) or an IANA zone. */
  timezone: string;
}

/** Professions List (professions' kind, its form is in ../professions): where it posts. */
export interface ProfessionsPostConfig {
  serverId: string;
  channelId: string;
}

export interface PluginRun {
  id: string;
  startedAt: string;
  status: PluginRunStatus;
  result: string | null;
  error: string | null;
}

interface PluginBase {
  id: string;
  kindLabel: string;
  name: string;
  enabled: boolean;
  schedule: PluginSchedule;
  /** e.g. "Every day at 02:00". */
  scheduleText: string;
  /** The schedule's timezone: `ST` (the guild's server time) or a zone. */
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: PluginRunStatus | null;
  lastError: string | null;
  lastResult: string | null;
  recentRuns: PluginRun[];
}

export type Plugin = PluginBase &
  (
    | { kind: 'CHANNEL_CLEANUP'; config: ChannelCleanupConfig }
    | { kind: 'RECURRING_EVENT'; config: RecurringEventConfig }
    | { kind: 'PROFESSIONS_POST'; config: ProfessionsPostConfig }
  );

export interface PluginInput {
  kind?: PluginKind;
  name?: string;
  enabled?: boolean;
  scheduleKind?: PluginScheduleKind;
  timeOfDay?: string;
  weekday?: number | null;
  dayOfMonth?: number | null;
  config?: ChannelCleanupConfig | RecurringEventConfig | ProfessionsPostConfig;
  /** Required to create one: it acts on its own, on a schedule. */
  confirm?: boolean;
  /** Creating only: first run `now` or at "yyyy-MM-ddTHH:mm" (guild timezone); else its schedule's. */
  firstRun?: string;
  /** The schedule's (and `firstRun`'s) timezone: `ST` (server time), `UTC` or a zone. */
  timezone?: string;
}

export const fetchPluginKinds = (guildId: string): Promise<PluginKindInfo[]> =>
  request('GET', `/api/guilds/${guildId}/plugin-kinds`);

export const fetchPlugins = (guildId: string): Promise<Plugin[]> =>
  request('GET', `/api/guilds/${guildId}/plugins`);

export const createPlugin = (guildId: string, input: PluginInput): Promise<Plugin> =>
  request('POST', `/api/guilds/${guildId}/plugins`, input);

export const updatePlugin = (id: string, input: PluginInput): Promise<Plugin> =>
  request('PATCH', `/api/plugins/${id}`, input);

export const runPluginNow = (id: string): Promise<void> =>
  request('POST', `/api/plugins/${id}/run-now`);

export const deletePlugin = (id: string): Promise<void> => request('DELETE', `/api/plugins/${id}`);
