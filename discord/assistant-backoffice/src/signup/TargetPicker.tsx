import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronIcon } from '../Icons';
import { MARKERS } from './labels';
import { MarkerMark } from './MarkerMark';
import { PlayerMark } from './PlayerMark';
import type { AssignmentTarget, Entry } from './signupApi';

/**
 * The target of an assignment line: none, a raid marker or a player — each shown with its
 * picture, which a native dropdown can't do.
 */
export function TargetPicker({
  gameVersion,
  players,
  value,
  onChange,
}: {
  gameVersion: string;
  players: Entry[];
  value: AssignmentTarget;
  onChange: (target: AssignmentTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const marker = (label: string) => <MarkerMark gameVersion={gameVersion} label={label} />;
  const show = (target: AssignmentTarget): ReactNode => {
    if (target === null) return <span className="muted">No target</span>;
    if (target.kind === 'marker') {
      const label = MARKERS.find((m) => m.marker === target.marker)?.label ?? target.marker;
      return (
        <span className="player-mark">
          {marker(label)}
          {label}
        </span>
      );
    }
    const entry = players.find((p) => p.id === target.entryId);
    return entry ? <PlayerMark gameVersion={gameVersion} entry={entry} /> : 'A player who left';
  };
  const pick = (target: AssignmentTarget) => {
    onChange(target);
    setOpen(false);
  };

  return (
    <div className="dropdown" ref={root}>
      <button
        type="button"
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{show(value)}</span>
        <span className="select-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox">
          <button
            type="button"
            className="dropdown-item dropdown-option"
            onClick={() => pick(null)}
          >
            <span className="muted">No target</span>
          </button>
          <div className="dropdown-hint muted">Raid markers</div>
          {MARKERS.map(({ marker: id, label }) => (
            <button
              key={id}
              type="button"
              className="dropdown-item dropdown-option"
              onClick={() => pick({ kind: 'marker', marker: id })}
            >
              <span className="player-mark">
                {marker(label)}
                {label}
              </span>
            </button>
          ))}
          <div className="dropdown-hint muted">Players</div>
          {players.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="dropdown-item dropdown-option"
              onClick={() => pick({ kind: 'player', entryId: entry.id })}
            >
              <PlayerMark gameVersion={gameVersion} entry={entry} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
