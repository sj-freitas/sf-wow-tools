import { useEffect, useRef, useState } from 'react';
import { fetchReactionUsers, fetchTaskReactions } from './api';
import type { Reaction } from './types';
import { InlineSpinner } from './Loading';
import { OneLine } from './OneLine';
import { useKeepInView } from './useKeepInView';

const REFRESH_MS = 10_000;

/**
 * Live reaction counts of a post (poll results), shown right on the post. Clicking a reaction shows
 * who reacted. Refreshes every 10 seconds while the page is visible and the post is tracked (the
 * API keeps the counts on the post and asks Discord again at most every 15 seconds). One row of the
 * same height whatever it shows (a spinner, "No reactions yet", the counts, a one-line error), and
 * who reacted opens over the page: nothing in the post's card moves.
 */
export function ReactionsPanel({
  taskId,
  part = 1,
  live = true,
}: {
  taskId: string;
  part?: number;
  /** The post is tracked: refresh the counts. Untracked, they're read once (they don't change). */
  live?: boolean;
}) {
  const [reactions, setReactions] = useState<Reaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Who reacted closes on a click outside it, or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(null);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    // Another post or message: its counts aren't known yet.
    setReactions(null);
    setError(null);
    const load = () => {
      if (document.hidden) return Promise.resolve();
      return fetchTaskReactions(taskId, part)
        .then((result) => {
          setReactions(result);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    };
    void load();
    if (!live) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [taskId, part, live]);

  // A refresh that fails keeps the counts it had.
  if (!reactions) {
    return (
      <div className="reactions">
        {error ? (
          <OneLine text={error} className="status-error" />
        ) : (
          <InlineSpinner className="muted" label="Loading reactions…" />
        )}
      </div>
    );
  }
  if (reactions.length === 0) {
    return (
      <div className="reactions">
        <span className="muted">No reactions yet</span>
      </div>
    );
  }
  const opened = reactions.find((reaction) => reaction.emoji === open);
  return (
    <div className="reactions" ref={root}>
      <ul className="reaction-list">
        {reactions.map((reaction) => (
          <li key={reaction.emoji}>
            <button
              type="button"
              className={
                reaction.emoji === open ? 'reaction-button reaction-button-open' : 'reaction-button'
              }
              title="Click to see who reacted"
              aria-expanded={reaction.emoji === open}
              onClick={() => setOpen(reaction.emoji === open ? null : reaction.emoji)}
            >
              {reaction.imageUrl ? (
                <img className="md-emoji" src={reaction.imageUrl} alt={reaction.emoji} />
              ) : (
                <span className="reaction-emoji">{reaction.emoji}</span>
              )}
              <strong>{reaction.count}</strong>
            </button>
          </li>
        ))}
      </ul>
      {opened && <Reactors taskId={taskId} part={part} reaction={opened} />}
    </div>
  );
}

/** The people behind one reaction; reloaded when its count changes. */
function Reactors({
  taskId,
  part,
  reaction,
}: {
  taskId: string;
  part: number;
  reaction: Reaction;
}) {
  const [people, setPeople] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  useKeepInView(popover, reaction.emoji);

  useEffect(() => {
    setError(null);
    fetchReactionUsers(taskId, reaction.emoji, part)
      .then(setPeople)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [taskId, part, reaction.emoji, reaction.count]);

  return (
    <div className="reactors reactors-popover" role="dialog" aria-label="Who reacted" ref={popover}>
      {error ? (
        <span className="status-error">{error}</span>
      ) : !people ? (
        <InlineSpinner className="muted" />
      ) : people.length === 0 ? (
        <span className="muted">Nobody yet.</span>
      ) : (
        people.map((person) => (
          <span key={person.id} className="badge">
            {person.name}
          </span>
        ))
      )}
    </div>
  );
}
