import { MARKERS, SCOPE_LABELS, entryName } from './labels';
import type { Assignment, AssignmentLine, Entry } from './signupApi';

/** "Boss · Patchwerk", "Raid · Naxxramas", "Everyone". */
export const scopeHeading = (assignment: Pick<Assignment, 'scope' | 'scopeLabel'>): string =>
  assignment.scopeLabel
    ? `${SCOPE_LABELS[assignment.scope]} · ${assignment.scopeLabel}`
    : SCOPE_LABELS[assignment.scope];

/** One line the way Discord shows it, minus the formatting. */
export function lineText(line: AssignmentLine, entries: Entry[]): string {
  const name = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    return entry ? entryName(entry) : null;
  };
  const players = line.entryIds.map(name).filter((n): n is string => n !== null);
  let target = '';
  if (line.target?.kind === 'marker') {
    const marker = line.target.marker;
    target = `[${MARKERS.find((m) => m.marker === marker)?.label ?? marker}]`;
  }
  if (line.target?.kind === 'player') target = name(line.target.entryId) ?? '';
  return [players.join(', '), line.task, target].filter((part) => part !== '').join(' ');
}
