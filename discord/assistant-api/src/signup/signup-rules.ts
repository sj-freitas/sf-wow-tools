import type { Role, SignupLockMode, SignupStatus } from '@prisma/client';
import type { EventKindConfig } from './event-kinds';

/**
 * The rules of event sign-ups, free of I/O. Who may do what:
 *
 *   - anyone who can see the event (on Discord, or in the backoffice as a member of the guild)
 *     signs themselves up while it is open;
 *   - Officers and holders of the guild's EventCreator role create events — only Officers in a
 *     channel other than the guild's event channel;
 *   - the event's owner (who created it) and Officers edit, lock, unlock and delete it, and add,
 *     change or remove anyone's sign-up, even once it is closed;
 *   - they and every EventCreator also organise it: the raid setup, assignments, reminders to
 *     people who haven't signed up, and reading the notes left with Late and Tentative.
 */

export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_LOCATION_LENGTH = 100;
export const MAX_NOTE_LENGTH = 200;

/**
 * Whether sign-ups are closed: archived, scheduled (not posted yet), locked by hand, or (AUTO)
 * the event has started.
 */
export const isClosed = (
  event: {
    lockMode: SignupLockMode;
    startsAt: Date;
    archivedAt?: Date | null;
    publishAt?: Date | null;
  },
  now: Date = new Date(),
): boolean =>
  (event.archivedAt ?? null) !== null ||
  (event.publishAt ?? null) !== null ||
  event.lockMode === 'LOCKED' ||
  (event.lockMode === 'AUTO' && event.startsAt <= now);

/** Scheduled: saved, but its sign-up post isn't in Discord yet (the worker posts it later). */
export const isScheduled = (event: { publishAt?: Date | null }): boolean =>
  (event.publishAt ?? null) !== null;

export interface SignupViewer {
  discordId: string;
  isOfficer: boolean;
  /** Holds the guild's EventCreator role (Officers count whether or not they hold it). */
  isEventCreator: boolean;
}

export const canCreateEvents = (viewer: SignupViewer): boolean =>
  viewer.isOfficer || viewer.isEventCreator;

/** Edit, lock and delete the event, and manage everyone's sign-ups. */
export const canManageEvent = (
  viewer: SignupViewer,
  event: { createdByDiscordId: string },
): boolean => viewer.isOfficer || event.createdByDiscordId === viewer.discordId;

/** Raid setup, assignments, reminders and the notes people left. */
export const canOrganizeEvent = (
  viewer: SignupViewer,
  event: { createdByDiscordId: string },
): boolean => canManageEvent(viewer, event) || viewer.isEventCreator;

/** Officers post anywhere in the guild's servers; EventCreators only in the event channel. */
export const canPostIn = (
  viewer: SignupViewer,
  defaultChannelId: string | null,
  channelId: string,
): boolean => viewer.isOfficer || (defaultChannelId !== null && channelId === defaultChannelId);

export const STATUS_LABELS: Record<SignupStatus, string> = {
  AVAILABLE: 'Signed up',
  LATE: 'Late',
  TENTATIVE: 'Tentative',
  ABSENT: 'Absent',
};

/** The sign-up post's categories, in the order shown. */
export const ROLE_CATEGORIES: readonly { role: Role; label: string }[] = [
  { role: 'TANK', label: '🛡️ Tank' },
  { role: 'HEALER', label: '💚 Healer' },
  { role: 'RANGED_DPS', label: '🏹 Ranged' },
  { role: 'MELEE_DPS', label: '⚔️ Melee' },
];

export const ROLE_EMOJI: Record<Role, string> = {
  TANK: '🛡️',
  HEALER: '💚',
  RANGED_DPS: '🏹',
  MELEE_DPS: '⚔️',
};

export const STATUS_CATEGORIES: readonly { status: SignupStatus; label: string }[] = [
  { status: 'LATE', label: '⏰ Late' },
  { status: 'TENTATIVE', label: '❔ Tentative' },
  { status: 'ABSENT', label: '❌ Absent' },
];

/**
 * Where an entry sits in the setup: group 1..groupCount and a place in it (0..groupSize-1, or any
 * when the group has no limit), or the bench (both null).
 */
export interface Placement {
  entryId: string;
  group: number | null;
  slot: number | null;
}

/**
 * What is wrong with a new setup, or null. Every placed entry must be one of the event's, at most
 * once, not Absent, in a free place of one of the event kind's groups (`event-kinds.ts`).
 */
export function validatePlacements(
  placements: readonly Placement[],
  entries: readonly { id: string; status: SignupStatus }[],
  layout: Pick<EventKindConfig, 'groupCount' | 'groupSize'>,
): string | null {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const taken = new Set<string>();
  for (const { entryId, group, slot } of placements) {
    const entry = byId.get(entryId);
    if (!entry) return 'Someone in the setup is no longer signed up. Reload the page.';
    if (seen.has(entryId)) return 'Someone is in the setup twice.';
    seen.add(entryId);
    if (group === null) {
      if (slot !== null) return 'The bench has no places.';
      continue;
    }
    if (!Number.isInteger(group) || group < 1 || group > layout.groupCount) {
      return layout.groupCount === 1
        ? 'There is only one group.'
        : `Groups go from 1 to ${layout.groupCount}.`;
    }
    const tooFar = layout.groupSize !== null && slot !== null && slot >= layout.groupSize;
    if (slot === null || !Number.isInteger(slot) || slot < 0 || tooFar) {
      return `A group has ${layout.groupSize} places.`;
    }
    if (entry.status === 'ABSENT') return 'Someone who is absent cannot be in a group.';
    const place = `${group}:${slot}`;
    if (taken.has(place)) return `Two people are in the same place of group ${group}.`;
    taken.add(place);
  }
  return null;
}
