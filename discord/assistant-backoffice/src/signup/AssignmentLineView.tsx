import { Fragment } from 'react';
import { MARKERS } from './labels';
import { MarkerMark } from './MarkerMark';
import { PlayerMark } from './PlayerMark';
import type { AssignmentLine, Entry } from './signupApi';

/**
 * One assignment line the way Discord shows it: the players (with their role and class icons),
 * the task, and the target (a raid marker's icon, or another player).
 */
export function AssignmentLineView({
  line,
  entries,
  gameVersion,
}: {
  line: AssignmentLine;
  entries: Entry[];
  gameVersion: string;
}) {
  const find = (id: string) => entries.find((e) => e.id === id) ?? null;
  const players = line.entryIds.map(find).filter((e): e is Entry => e !== null);
  const target = line.target;
  const targetPlayer = target?.kind === 'player' ? find(target.entryId) : null;
  // In a sentence on a wide screen (as in Discord); on a phone signup.css lays the parts out as a
  // card: the task and its target on top, the players under them.
  return (
    <>
      <span className="assignment-line-players">
        {players.map((entry, i) => (
          <Fragment key={entry.id}>
            {i > 0 && <span className="assignment-line-sep">, </span>}
            <PlayerMark gameVersion={gameVersion} entry={entry} bold />
          </Fragment>
        ))}
      </span>
      {line.task && <span className="assignment-line-task"> {line.task}</span>}
      {target?.kind === 'marker' && (
        <span className="assignment-line-target">
          {' '}
          <MarkerMark
            gameVersion={gameVersion}
            label={MARKERS.find((m) => m.marker === target.marker)?.label ?? target.marker}
          />
        </span>
      )}
      {targetPlayer && (
        <span className="assignment-line-target">
          {' '}
          <PlayerMark gameVersion={gameVersion} entry={targetPlayer} bold />
        </span>
      )}
    </>
  );
}
