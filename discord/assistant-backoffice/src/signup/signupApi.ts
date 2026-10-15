import { request } from '../api';
import type { Role } from '../types';

/** Event sign-ups (API: /api/guilds/:guildId/signup/...). */

export type SignupStatus = 'AVAILABLE' | 'LATE' | 'TENTATIVE' | 'ABSENT';
export type LockMode = 'AUTO' | 'LOCKED' | 'UNLOCKED';
export type AssignmentScope = 'GLOBAL' | 'RAID' | 'BOSS';
export type Marker =
  'SKULL' | 'CROSS' | 'SQUARE' | 'MOON' | 'TRIANGLE' | 'DIAMOND' | 'CIRCLE' | 'STAR';

export interface SignupSettings {
  /** Where events go unless an Officer picks another channel. */
  channel: { serverId: string; channelId: string } | null;
  eventCreatorRole: { id: string; name: string } | null;
  /** Guild-Assistants and Officers change the settings. */
  canConfigure: boolean;
  canCreate: boolean;
  isOfficer: boolean;
}

export interface EventSummary {
  id: string;
  title: string;
  startsAt: string;
  timezone: string;
  closed: boolean;
  /** When it was archived; null for an event that isn't. */
  archivedAt: string | null;
  createdByName: string;
  counts: Record<SignupStatus, number>;
  myStatus: SignupStatus | null;
}

export interface Entry {
  id: string;
  discordUserId: string;
  discordName: string;
  characterId: string | null;
  characterName: string | null;
  characterClass: string | null;
  role: Role | null;
  status: SignupStatus;
  /** Only for organisers and the person themselves (null otherwise). */
  note: string | null;
  groupNumber: number | null;
  groupSlot: number | null;
  /** When they first answered: sign-ups are numbered in this order, as in Discord. */
  createdAt: string;
  updatedAt: string;
}

export interface CharacterOption {
  id: string;
  name: string;
  class: string;
  roles: Role[];
  isMain: boolean;
  inGuild: boolean;
}

export type AssignmentTarget =
  { kind: 'marker'; marker: Marker } | { kind: 'player'; entryId: string } | null;

export interface AssignmentLine {
  entryIds: string[];
  task: string;
  target: AssignmentTarget;
}

export interface Assignment {
  id: string;
  scope: AssignmentScope;
  scopeLabel: string;
  title: string;
  lines: AssignmentLine[];
  mentions: boolean;
  imageIds: string[];
  /** Its message in Discord; null when not posted. */
  postUrl: string | null;
  pluginKey: string | null;
  editedManually: boolean;
}

export interface SignupEvent {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  /** The zone the time was entered in, and the guild's server time. */
  timezone: string;
  serverTimezone: string;
  /** The date and time in `timezone`, for the edit form. */
  local: { date: string; time: string };
  lockMode: LockMode;
  closed: boolean;
  /** Archived (read-only, not in Discord) since then; null for an event that isn't. */
  archivedAt: string | null;
  createdByName: string;
  isOwner: boolean;
  channel: { serverId: string; channelId: string };
  postUrl: string | null;
  setupPostUrl: string | null;
  setupMentions: boolean;
  /** Manage: edit, lock, delete, anyone's sign-up. Organise: setup, assignments, reminders. */
  permissions: {
    canManage: boolean;
    canOrganize: boolean;
    /** Officers change or remove anyone's sign-up; everyone else only their own. */
    isOfficer: boolean;
  };
  entries: Entry[];
  mine: Entry | null;
  myCharacters: CharacterOption[];
  assignments: Assignment[];
}

export interface EventForm {
  title: string;
  description: string;
  /** YYYY-MM-DD and HH:mm in `timezone` (`ST` for server time). */
  date: string;
  time: string;
  timezone: string;
  /** Officers only, when creating; left out = the guild's event channel. */
  channel?: { serverId: string; channelId: string };
}

export interface SignupInput {
  /** Absent may leave it out. */
  characterId?: string;
  role?: Role;
  status: SignupStatus;
  note?: string;
}

export interface MissingPerson {
  discordUserId: string;
  name: string;
  mains: string[];
  isRaider: boolean;
  reminders: number;
  lastReminderAt: string | null;
  lastDelivered: boolean | null;
}

export interface Missing {
  source: 'servers' | 'known';
  hasRaiderRole: boolean;
  people: MissingPerson[];
}

export interface Placement {
  entryId: string;
  group: number | null;
  slot: number | null;
}

export interface AssignmentInput {
  scope: AssignmentScope;
  scopeLabel: string;
  title: string;
  lines: AssignmentLine[];
  mentions: boolean;
  imageIds: string[];
}

const base = (guildId: string) => `/api/guilds/${guildId}/signup`;
const ev = (guildId: string, eventId: string) => `${base(guildId)}/events/${eventId}`;

export const fetchSignupSettings = (guildId: string): Promise<SignupSettings> =>
  request('GET', `${base(guildId)}/settings`);

export const saveSignupSettings = (
  guildId: string,
  patch: {
    channel?: { serverId: string; channelId: string } | null;
    eventCreatorRoleId?: string | null;
  },
): Promise<void> => request('PUT', `${base(guildId)}/settings`, patch);

export type EventsView = 'upcoming' | 'past' | 'archived';

/** Archived events can be narrowed by day (YYYY-MM-DD, both included) and by words in the name. */
export function fetchEvents(
  guildId: string,
  view: EventsView,
  filter: { from?: string; to?: string; q?: string } = {},
): Promise<EventSummary[]> {
  const params = new URLSearchParams({ view });
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.q?.trim()) params.set('q', filter.q.trim());
  return request('GET', `${base(guildId)}/events?${params.toString()}`);
}

export const createEvent = (guildId: string, form: EventForm): Promise<{ id: string }> =>
  request('POST', `${base(guildId)}/events`, form);

export const fetchEvent = (guildId: string, eventId: string): Promise<SignupEvent> =>
  request('GET', ev(guildId, eventId));

export const updateEvent = (guildId: string, eventId: string, form: EventForm): Promise<void> =>
  request('PUT', ev(guildId, eventId), form);

export const setEventLock = (guildId: string, eventId: string, mode: LockMode): Promise<void> =>
  request('PUT', `${ev(guildId, eventId)}/lock`, { mode });

export const deleteEvent = (guildId: string, eventId: string): Promise<void> =>
  request('DELETE', ev(guildId, eventId));

/** Removes the event's messages from Discord and keeps it, read-only, under Archived. */
export const archiveEvent = (guildId: string, eventId: string): Promise<void> =>
  request('POST', `${ev(guildId, eventId)}/archive`);

/** Takes an archived event back out and posts it again. */
export const restoreEvent = (guildId: string, eventId: string): Promise<void> =>
  request('POST', `${ev(guildId, eventId)}/restore`);

export const saveMySignup = (guildId: string, eventId: string, input: SignupInput): Promise<void> =>
  request('PUT', `${ev(guildId, eventId)}/my-signup`, input);

export const withdrawMySignup = (guildId: string, eventId: string): Promise<void> =>
  request('DELETE', `${ev(guildId, eventId)}/my-signup`);

export const fetchCharacterOptions = (
  guildId: string,
  eventId: string,
  discordUserId: string,
): Promise<CharacterOption[]> =>
  request('GET', `${ev(guildId, eventId)}/people/${discordUserId}/characters`);

export const saveSomeonesSignup = (
  guildId: string,
  eventId: string,
  discordUserId: string,
  input: SignupInput & { name?: string },
): Promise<void> => request('PUT', `${ev(guildId, eventId)}/people/${discordUserId}`, input);

export const removeEntry = (guildId: string, eventId: string, entryId: string): Promise<void> =>
  request('DELETE', `${ev(guildId, eventId)}/entries/${entryId}`);

export const saveSetup = (
  guildId: string,
  eventId: string,
  placements: Placement[],
): Promise<void> => request('PUT', `${ev(guildId, eventId)}/setup`, { placements });

export const postSetup = (guildId: string, eventId: string, mention: boolean): Promise<void> =>
  request('POST', `${ev(guildId, eventId)}/setup/post`, { mention });

export const removeSetupPost = (guildId: string, eventId: string): Promise<void> =>
  request('DELETE', `${ev(guildId, eventId)}/setup/post`);

export const fetchMissing = (guildId: string, eventId: string): Promise<Missing> =>
  request('GET', `${ev(guildId, eventId)}/missing`);

export const sendReminder = (
  guildId: string,
  eventId: string,
  discordUserId: string,
): Promise<{ delivered: boolean; sentAt: string }> =>
  request('POST', `${ev(guildId, eventId)}/reminders`, { discordUserId });

export const createAssignment = (
  guildId: string,
  eventId: string,
  input: AssignmentInput,
): Promise<void> => request('POST', `${ev(guildId, eventId)}/assignments`, input);

export const updateAssignment = (
  guildId: string,
  eventId: string,
  assignmentId: string,
  input: AssignmentInput,
): Promise<void> => request('PUT', `${ev(guildId, eventId)}/assignments/${assignmentId}`, input);

export const deleteAssignment = (
  guildId: string,
  eventId: string,
  assignmentId: string,
): Promise<void> => request('DELETE', `${ev(guildId, eventId)}/assignments/${assignmentId}`);

export const reorderAssignments = (
  guildId: string,
  eventId: string,
  ids: string[],
): Promise<void> => request('PUT', `${ev(guildId, eventId)}/assignment-order`, { ids });

/** Another event's assignments, as offered for copying. */
export interface AssignmentSource {
  id: string;
  title: string;
  startsAt: string;
  timezone: string;
  assignments: { id: string; title: string; scope: AssignmentScope; scopeLabel: string }[];
}

export const fetchAssignmentSources = (
  guildId: string,
  eventId: string,
): Promise<AssignmentSource[]> => request('GET', `${ev(guildId, eventId)}/assignment-sources`);

/** `dropped`: people in the copied lines who aren't signed up here, so were left out. */
export const copyAssignments = (
  guildId: string,
  eventId: string,
  fromEventId: string,
  assignmentIds: string[],
): Promise<{ copied: number; dropped: number }> =>
  request('POST', `${ev(guildId, eventId)}/assignment-copies`, { fromEventId, assignmentIds });

export const postAssignments = (guildId: string, eventId: string): Promise<void> =>
  request('POST', `${ev(guildId, eventId)}/assignment-posts`);

export const removeAssignmentPosts = (guildId: string, eventId: string): Promise<void> =>
  request('DELETE', `${ev(guildId, eventId)}/assignment-posts`);

export function uploadAssignmentImage(
  guildId: string,
  eventId: string,
  file: File,
): Promise<{ id: string }> {
  const form = new FormData();
  form.append('image', file);
  return request('POST', `${ev(guildId, eventId)}/images`, form);
}

export const assignmentImageUrl = (guildId: string, eventId: string, imageId: string): string =>
  `${ev(guildId, eventId)}/images/${imageId}`;
