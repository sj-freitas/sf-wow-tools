import { useState } from 'react';
import { entryName, MARKERS } from './labels';
import type { AssignmentLine, Entry } from './signupApi';

/** Served by the API from `src/game/<version>/raid-markers/<Marker>.png`. */
const markerUrl = (gameVersion: string, marker: string): string =>
  `/api/public/games/${encodeURIComponent(gameVersion)}/markers/${encodeURIComponent(marker)}/icon`;

/** A raid marker as its icon, or "[Skull]" when it has none (as in Discord). */
function MarkerMark({ gameVersion, label }: { gameVersion: string; label: string }) {
  const [noIcon, setNoIcon] = useState(false);
  if (noIcon) return <>[{label}]</>;
  return (
    <img
      className="marker-icon"
      src={markerUrl(gameVersion, label)}
      alt={label}
      title={label}
      onError={() => setNoIcon(true)}
    />
  );
}

/** One assignment line the way Discord shows it: players, the task, and the target. */
export function AssignmentLineView({
  line,
  entries,
  gameVersion,
}: {
  line: AssignmentLine;
  entries: Entry[];
  gameVersion: string;
}) {
  const name = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    return entry ? entryName(entry) : null;
  };
  const players = line.entryIds.map(name).filter((n): n is string => n !== null);
  const target = line.target;
  return (
    <>
      {players.length > 0 && <strong>{players.join(', ')}</strong>}
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
      {target?.kind === 'player' && name(target.entryId) && (
        <>
          {' '}
          <strong>{name(target.entryId)}</strong>
        </>
      )}
    </>
  );
}
