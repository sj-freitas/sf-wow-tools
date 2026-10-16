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
  return (
    <>
      {players.map((entry, i) => (
        <Fragment key={entry.id}>
          {i > 0 && ', '}
          <PlayerMark gameVersion={gameVersion} entry={entry} bold />
        </Fragment>
      ))}
      {line.task && ` ${line.task}`}
      {target?.kind === 'marker' && (
        <>
          {' '}
          <MarkerMark
            gameVersion={gameVersion}
            label={MARKERS.find((m) => m.marker === target.marker)?.label ?? target.marker}
          />
        </>
      )}
      {targetPlayer && (
        <>
          {' '}
          <PlayerMark gameVersion={gameVersion} entry={targetPlayer} bold />
        </>
      )}
    </>
  );
}
