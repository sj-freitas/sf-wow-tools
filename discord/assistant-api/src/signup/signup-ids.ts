import type { Role, SignupStatus } from '@prisma/client';

/**
 * The `custom_id`s of the sign-up post's buttons and of the private steps that follow. Discord
 * allows 100 characters, so ids are written as 32 hex digits (a uuid without its dashes) and
 * statuses and roles as one letter.
 *
 *   su-join:<event>                         Sign up (the post's button)
 *   su-late:<event> / su-tent:<event>       Late / Tentative (the post's buttons)
 *   su-absent:<event>                       Absent (the post's button)
 *   su-pick:<event>:<status>                the menu of your characters in each role; each
 *                                           option's value is <character>.<role>
 *   su-note:<event>:<status>[:<character>:<role>]   the Late / Tentative note form
 */
export const PREFIX = {
  join: 'su-join',
  late: 'su-late',
  tentative: 'su-tent',
  absent: 'su-absent',
  pick: 'su-pick',
  note: 'su-note',
} as const;

const STATUS_CODES: Record<SignupStatus, string> = {
  AVAILABLE: 'A',
  LATE: 'L',
  TENTATIVE: 'T',
  ABSENT: 'X',
};
const ROLE_CODES: Record<Role, string> = {
  TANK: 'T',
  HEALER: 'H',
  MELEE_DPS: 'M',
  RANGED_DPS: 'R',
};

const invert = <K extends string>(codes: Record<K, string>) =>
  new Map(Object.entries(codes).map(([key, code]) => [code as string, key as K]));
const STATUS_BY_CODE = invert(STATUS_CODES);
const ROLE_BY_CODE = invert(ROLE_CODES);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const compactId = (uuid: string): string => uuid.replace(/-/g, '').toLowerCase();

export function expandId(compact: string | undefined): string | null {
  if (!compact || !/^[0-9a-f]{32}$/i.test(compact)) return null;
  const c = compact.toLowerCase();
  const uuid = `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20)}`;
  return UUID.test(uuid) ? uuid : null;
}

export const statusCode = (status: SignupStatus): string => STATUS_CODES[status];
export const roleCode = (role: Role): string => ROLE_CODES[role];
export const roleOfCode = (code: string | undefined): Role | null =>
  (code && ROLE_BY_CODE.get(code)) || null;

export const customId = (prefix: string, ...parts: string[]): string =>
  [prefix, ...parts].join(':');

/** The parts of a sign-up `custom_id` after its prefix, decoded; null if any part is bad. */
export interface ParsedId {
  eventId: string;
  status: SignupStatus | null;
  characterId: string | null;
  role: Role | null;
}

export function parseCustomId(value: string | undefined): ParsedId | null {
  const [, event, status, ...rest] = (value ?? '').split(':');
  const eventId = expandId(event);
  if (!eventId) return null;
  const parsed: ParsedId = { eventId, status: null, characterId: null, role: null };
  if (status !== undefined) {
    parsed.status = STATUS_BY_CODE.get(status) ?? null;
    if (!parsed.status) return null;
  }
  // After the status, in any order: a character (32 hex digits) and/or a role (one letter).
  for (const part of rest) {
    if (part.length === 1) {
      parsed.role = ROLE_BY_CODE.get(part) ?? null;
      if (!parsed.role) return null;
    } else {
      parsed.characterId = expandId(part);
      if (!parsed.characterId) return null;
    }
  }
  return parsed;
}
