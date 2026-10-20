import { useEffect, useState } from 'react';
import { InlineSpinner, Spinner } from '../Loading';
import type { Guild } from '../types';
import { scopeHeading } from './assignmentText';
import { Drawer } from '../Drawer';
import { errorText, formatEventTime } from './labels';
import {
  copyAssignments,
  fetchAssignmentSources,
  type AssignmentSource,
  type SignupEvent,
} from './signupApi';

/**
 * Copying assignments from another of the guild's events: pick the event, tick the assignments
 * (all at first), copy. People are matched to this event's sign-ups; anyone not signed up here is
 * left out of the copies, and the result says how many.
 */
export function CopyAssignmentsDrawer({
  guild,
  event,
  onClose,
  onCopied,
}: {
  guild: Guild;
  event: SignupEvent;
  onClose: () => void;
  onCopied: (message: string) => void;
}) {
  const [sources, setSources] = useState<AssignmentSource[] | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAssignmentSources(guild.id, event.id)
      .then(setSources)
      .catch((err: unknown) => setError(errorText(err)));
  }, [guild.id, event.id]);

  const source = sources?.find((s) => s.id === sourceId);
  const choose = (id: string) => {
    setSourceId(id);
    const chosen = sources?.find((s) => s.id === id);
    setPicked(new Set(chosen?.assignments.map((a) => a.id) ?? []));
  };
  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = () => {
    if (!source) return;
    setBusy(true);
    setError(null);
    copyAssignments(guild.id, event.id, source.id, [...picked])
      .then(({ copied, dropped }) => {
        onCopied(
          `Copied ${copied} assignment${copied === 1 ? '' : 's'} from “${source.title}”.` +
            (dropped > 0
              ? ` ${dropped} mention${dropped === 1 ? ' was' : 's were'} of people not signed up here, so ${dropped === 1 ? 'it was' : 'they were'} left out.`
              : ''),
        );
        onClose();
      })
      .catch((err: unknown) => {
        setError(errorText(err));
        setBusy(false);
      });
  };

  return (
    <Drawer title="Copy assignments" onClose={onClose}>
      <div className="signup-editor">
        {sources === null ? (
          error ? (
            <p className="status-error">{error}</p>
          ) : (
            <Spinner />
          )
        ) : sources.length === 0 ? (
          <p className="muted">No other event of the guild has assignments yet.</p>
        ) : (
          <>
            <label className="field">
              From
              <select value={sourceId} onChange={(e) => choose(e.target.value)}>
                <option value="">Pick an event…</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} · {formatEventTime(s.startsAt, s.timezone)} · {s.assignments.length}{' '}
                    assignment{s.assignments.length === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>
            {source && (
              <fieldset className="copy-list">
                <legend>Assignments to copy</legend>
                {source.assignments.map((assignment) => (
                  <label key={assignment.id} className="copy-item">
                    <input
                      type="checkbox"
                      checked={picked.has(assignment.id)}
                      onChange={() => toggle(assignment.id)}
                    />
                    <span>
                      <strong>{assignment.title}</strong>
                      <span className="muted"> · {scopeHeading(assignment)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="muted">
              Copies go at the end, with their images. People are matched to this event’s sign-ups
              (same character, else same person); anyone not signed up here is left out.
              {event.assignments.some((a) => a.postUrl) &&
                ' This event’s assignments are in Discord, so the copies are posted too.'}
            </p>
            {error && <p className="status-error">{error}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!source || picked.size === 0 || busy}
                onClick={copy}
              >
                {busy ? (
                  <InlineSpinner label="Copying…" />
                ) : picked.size === 0 ? (
                  'Copy'
                ) : (
                  `Copy ${picked.size} assignment${picked.size === 1 ? '' : 's'}`
                )}
              </button>
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
