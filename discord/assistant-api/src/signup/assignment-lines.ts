/**
 * The lines of an assignment, stored as JSON on `SignupAssignment.lines`. A line gives some
 * signed-up players (by sign-up entry id) a task, optionally with a target: a raid marker or
 * another player. "Darkshivan <heals> Tearyn", "Darkshivan <tanks> Cross", or just
 * "Darkshivan <moves to the end of the room>".
 */

export const MARKERS = [
  'SKULL',
  'CROSS',
  'SQUARE',
  'MOON',
  'TRIANGLE',
  'DIAMOND',
  'CIRCLE',
  'STAR',
] as const;
export type Marker = (typeof MARKERS)[number];

/** Shown as text for now; the raid icons can replace these later. */
export const MARKER_LABELS: Record<Marker, string> = {
  SKULL: 'Skull',
  CROSS: 'Cross',
  SQUARE: 'Square',
  MOON: 'Moon',
  TRIANGLE: 'Triangle',
  DIAMOND: 'Diamond',
  CIRCLE: 'Circle',
  STAR: 'Star',
};

export type AssignmentTarget =
  { kind: 'marker'; marker: Marker } | { kind: 'player'; entryId: string } | null;

export interface AssignmentLine {
  entryIds: string[];
  task: string;
  target: AssignmentTarget;
}

export const MAX_LINES = 30;
export const MAX_TASK_LENGTH = 200;
const MAX_PLAYERS_PER_LINE = 40;

const isMarker = (value: unknown): value is Marker =>
  typeof value === 'string' && (MARKERS as readonly string[]).includes(value);

/** `entryIds` null: any player is accepted (reading stored lines). */
function parseTarget(
  value: unknown,
  entryIds: ReadonlySet<string> | null,
): AssignmentTarget | string {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return 'A target is a raid marker or a player.';
  const target = value as Record<string, unknown>;
  if (target.kind === 'marker' && isMarker(target.marker)) {
    return { kind: 'marker', marker: target.marker };
  }
  if (target.kind === 'player' && typeof target.entryId === 'string') {
    if (entryIds && !entryIds.has(target.entryId)) return 'A target player is no longer signed up.';
    return { kind: 'player', entryId: target.entryId };
  }
  return 'A target is a raid marker or a player.';
}

/**
 * The lines sent by the backoffice, checked against the event's sign-ups (`entryIds`), or what is
 * wrong with them. Empty lines (no players and no task) are dropped.
 */
export function parseLines(
  value: unknown,
  entryIds: ReadonlySet<string>,
): AssignmentLine[] | string {
  if (!Array.isArray(value)) return 'The assignment has no lines.';
  const lines: AssignmentLine[] = [];
  for (const raw of value as unknown[]) {
    if (!raw || typeof raw !== 'object') return 'A line of the assignment is not valid.';
    const line = raw as Record<string, unknown>;
    const ids = Array.isArray(line.entryIds) ? (line.entryIds as unknown[]) : [];
    if (ids.some((id) => typeof id !== 'string')) return 'A line names a player wrongly.';
    const players = [...new Set(ids as string[])];
    if (players.length > MAX_PLAYERS_PER_LINE) return 'A line names too many players.';
    if (players.some((id) => !entryIds.has(id))) {
      return 'A player in the assignment is no longer signed up. Reload the page.';
    }
    const task = typeof line.task === 'string' ? line.task.trim() : '';
    if (task.length > MAX_TASK_LENGTH) {
      return `A line can be at most ${MAX_TASK_LENGTH} characters.`;
    }
    const target = parseTarget(line.target, entryIds);
    if (typeof target === 'string') return target;
    if (players.length === 0 && task === '' && target === null) continue;
    lines.push({ entryIds: players, task, target });
  }
  if (lines.length > MAX_LINES) return `An assignment can have at most ${MAX_LINES} lines.`;
  return lines;
}

/** Stored lines, read leniently: anything malformed is skipped rather than failing the page. */
export function readLines(value: unknown): AssignmentLine[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const line = raw as Record<string, unknown>;
    const entryIds = Array.isArray(line.entryIds)
      ? (line.entryIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const task = typeof line.task === 'string' ? line.task : '';
    const target = parseTarget(line.target, null);
    return [{ entryIds, task, target: typeof target === 'string' ? null : target }];
  });
}

/** Every sign-up entry an assignment's lines mention (players and target players). */
export const entriesIn = (lines: readonly AssignmentLine[]): string[] => [
  ...new Set(
    lines.flatMap((line) => [
      ...line.entryIds,
      ...(line.target?.kind === 'player' ? [line.target.entryId] : []),
    ]),
  ),
];

/**
 * One line as Discord shows it: "• **Darkshivan**, **Tearyn** heal **Arthas**". Players who are
 * no longer signed up (`nameOf` gives null) are left out; null when nothing is left to say.
 */
export function renderLine(
  line: AssignmentLine,
  nameOf: (entryId: string) => string | null,
  /** A marker's emoji (`<:m_skull_…:id>`), or '' to write it as text: "[Skull]". */
  markerEmoji: (marker: string) => string = () => '',
  /** Pictures in front of a player's name (their role and class icons), or ''. */
  iconsOf: (entryId: string) => string = () => '',
): string | null {
  const person = (entryId: string): string | null => {
    const name = nameOf(entryId);
    if (name === null) return null;
    const icons = iconsOf(entryId);
    return icons ? `${icons} **${name}**` : `**${name}**`;
  };
  const players = line.entryIds.map(person).filter((name): name is string => name !== null);
  let target = '';
  if (line.target?.kind === 'marker') {
    const label = MARKER_LABELS[line.target.marker];
    target = markerEmoji(label) || `[${label}]`;
  }
  if (line.target?.kind === 'player') target = person(line.target.entryId) ?? '';
  const text = [players.join(', '), line.task, target].filter((part) => part !== '').join(' ');
  return text === '' ? null : `• ${text}`;
}

/**
 * Lines copied to another event: each player (a sign-up entry of the old event) becomes their
 * entry in the new one (`mapEntry`, null when they aren't signed up there). Players who aren't are
 * dropped, a target player who isn't loses the target, and a line left with nothing is dropped.
 * `dropped` counts the player references that couldn't be carried over.
 */
export function remapLines(
  lines: readonly AssignmentLine[],
  mapEntry: (entryId: string) => string | null,
): { lines: AssignmentLine[]; dropped: number } {
  let dropped = 0;
  const result: AssignmentLine[] = [];
  for (const line of lines) {
    const entryIds: string[] = [];
    for (const id of line.entryIds) {
      const mapped = mapEntry(id);
      if (mapped === null) dropped++;
      else if (!entryIds.includes(mapped)) entryIds.push(mapped);
    }
    let target = line.target;
    if (target?.kind === 'player') {
      const mapped = mapEntry(target.entryId);
      if (mapped === null) dropped++;
      target = mapped === null ? null : { kind: 'player', entryId: mapped };
    }
    if (entryIds.length === 0 && line.task === '' && target === null) continue;
    result.push({ entryIds, task: line.task, target });
  }
  return { lines: result, dropped };
}
