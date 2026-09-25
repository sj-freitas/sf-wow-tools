import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchTask } from './api';
import { PostTaskForm } from './PostTaskForm';
import type { Guild, ScheduledPost } from './types';
import { useChannels } from './useChannels';
import { useReturnTo } from './useReturnTo';
import { guildPath } from './guildPath';

interface Props {
  guild: Guild;
  timezone: string;
}

/** `/posts/create` and `/posts/edit/:id`: the post form on its own page. */
export function PostEditorPage({ guild, timezone }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const back = useReturnTo(guildPath(guild, 'posts'));
  const { channels } = useChannels(guild.id);
  const [post, setPost] = useState<ScheduledPost | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setPost(null);
    fetchTask(id)
      .then(setPost)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  const body = () => {
    if (!id) {
      return (
        <PostTaskForm
          guild={guild}
          channels={channels}
          timezone={timezone}
          onSaved={() => navigate(back)}
          onCancel={() => navigate(back)}
        />
      );
    }
    if (error) return <p className="status-error">{error}</p>;
    if (!post) return <p className="empty">Loading…</p>;
    return (
      <PostTaskForm
        guild={guild}
        channels={channels}
        editing={post}
        timezone={timezone}
        onSaved={() => navigate(back)}
        onCancel={() => navigate(back)}
      />
    );
  };

  return (
    <div className="tasks">
      <Link className="back-link" to={back}>
        ← Posts
      </Link>
      {body()}
    </div>
  );
}
