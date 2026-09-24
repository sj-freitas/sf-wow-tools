import { useEffect, useState } from 'react';
import { fetchTaskReactions } from './api';
import type { Reaction } from './types';

/** Live reaction counts of a post (poll results), refreshed while it is open. */
export function ReactionsPanel({ taskId }: { taskId: string }) {
  const [reactions, setReactions] = useState<Reaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetchTaskReactions(taskId)
        .then((result) => {
          setReactions(result);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [taskId]);

  if (error) return <p className="status-error">{error}</p>;
  if (!reactions) return <p className="muted">Loading reactions…</p>;
  if (reactions.length === 0) return <p className="muted">No reactions yet.</p>;
  return (
    <ul className="reaction-list">
      {reactions.map((reaction) => (
        <li key={reaction.emoji}>
          {reaction.imageUrl ? (
            <img className="md-emoji" src={reaction.imageUrl} alt={reaction.emoji} />
          ) : (
            <span className="reaction-emoji">{reaction.emoji}</span>
          )}
          <strong>{reaction.count}</strong>
        </li>
      ))}
    </ul>
  );
}
