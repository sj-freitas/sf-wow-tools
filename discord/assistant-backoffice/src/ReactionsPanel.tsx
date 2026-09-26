import { useEffect, useState } from 'react';
import { fetchReactionUsers, fetchTaskReactions } from './api';
import type { Reaction } from './types';

const REFRESH_MS = 10_000;

/**
 * Live reaction counts of a post (poll results), shown right on the post. Clicking a reaction shows
 * who reacted. Refreshes every 10 seconds while the page is visible; shows nothing until somebody
 * has reacted.
 */
export function ReactionsPanel({ taskId }: { taskId: string }) {
  const [reactions, setReactions] = useState<Reaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      if (document.hidden) return Promise.resolve();
      return fetchTaskReactions(taskId)
        .then((result) => {
          setReactions(result);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [taskId]);

  if (error) return <p className="status-error">{error}</p>;
  if (!reactions || reactions.length === 0) return null;
  const opened = reactions.find((reaction) => reaction.emoji === open);
  return (
    <>
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
      {opened && <Reactors taskId={taskId} reaction={opened} />}
    </>
  );
}

/** The people behind one reaction; reloaded when its count changes. */
function Reactors({ taskId, reaction }: { taskId: string; reaction: Reaction }) {
  const [people, setPeople] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    fetchReactionUsers(taskId, reaction.emoji)
      .then(setPeople)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [taskId, reaction.emoji, reaction.count]);

  return (
    <div className="reactors">
      {error ? (
        <span className="status-error">{error}</span>
      ) : !people ? (
        <span className="muted">Loading…</span>
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
