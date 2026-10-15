import type { Role } from '../types';
import type { AssignmentScope, Entry, Marker, SignupStatus } from './signupApi';

/** The sign-up post's categories, in its order and with its emojis. */
export const ROLE_CATEGORIES: { role: Role; label: string; emoji: string }[] = [
  { role: 'TANK', label: 'Tank', emoji: '🛡️' },
  { role: 'HEALER', label: 'Healer', emoji: '💚' },
  { role: 'RANGED_DPS', label: 'Ranged', emoji: '🏹' },
  { role: 'MELEE_DPS', label: 'Melee', emoji: '⚔️' },
];

export const ROLE_EMOJI = Object.fromEntries(
  ROLE_CATEGORIES.map((category) => [category.role, category.emoji]),
) as Record<Role, string>;

export const ROLE_NAME = Object.fromEntries(
  ROLE_CATEGORIES.map((category) => [category.role, category.label]),
) as Record<Role, string>;

export const STATUS_LABELS: Record<SignupStatus, string> = {
  AVAILABLE: 'Signed up',
  LATE: 'Late',
  TENTATIVE: 'Tentative',
  ABSENT: 'Absent',
};

export const STATUS_EMOJI: Record<SignupStatus, string> = {
  AVAILABLE: '✅',
  LATE: '⏰',
  TENTATIVE: '❔',
  ABSENT: '❌',
};

export const SCOPE_LABELS: Record<AssignmentScope, string> = {
  GLOBAL: 'Everyone',
  RAID: 'Raid',
  BOSS: 'Boss',
};

export const MARKERS: { marker: Marker; label: string }[] = [
  { marker: 'SKULL', label: 'Skull' },
  { marker: 'CROSS', label: 'Cross' },
  { marker: 'SQUARE', label: 'Square' },
  { marker: 'MOON', label: 'Moon' },
  { marker: 'TRIANGLE', label: 'Triangle' },
  { marker: 'DIAMOND', label: 'Diamond' },
  { marker: 'CIRCLE', label: 'Circle' },
  { marker: 'STAR', label: 'Star' },
];

export const entryName = (entry: Entry): string => entry.characterName ?? entry.discordName;

/** "Tue 20 Oct 2026, 20:00" in `timezone`. */
export function formatEventTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso));
}

/** "ST" for the guild's server time, else the zone's name. */
export const zoneLabel = (timezone: string, serverTimezone: string): string =>
  timezone === serverTimezone ? `ST (${timezone})` : timezone;

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
