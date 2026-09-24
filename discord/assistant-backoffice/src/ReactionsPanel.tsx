import { useEffect, useState } from 'react';
import { fetchTaskReactions } from './api';
import type { Reaction } from './types';

/**
 * Live reaction counts of a post (poll results), shown right on the post. Refreshes every 10
 * seconds while the page is visible; shows nothing until somebody has reacted.
 */
export function ReactionsPanel({ taskId }: { taskId: string }) {
  const [reactions, setReactions] = useState<Reaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [taskId]);

  if (error) return <p className="status-error">{error}</p>;
  if (!reactions || reactions.length === 0) return null;
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
