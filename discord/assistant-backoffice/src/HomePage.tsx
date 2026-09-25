import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchHome } from './api';
import { guildPath } from './guildPath';
import { MarkdownView } from './MarkdownView';
import { WelcomeEditor } from './WelcomeEditor';
import { formatWhen } from './time';
import type { Guild, GuildHome } from './types';

interface Props {
  guild: Guild;
  timezone: string;
}

function useHome(guildId: string): { home: GuildHome | null; error: string | null } {
  const [home, setHome] = useState<GuildHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setHome(null);
    fetchHome(guildId)
      .then(setHome)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guildId]);
  return { home, error };
}

/** The guild's welcome post: everyone in the guild reads it, Officers edit it. */
export function HomePage({ guild, timezone }: Props) {
  const { home, error } = useHome(guild.id);

  return (
    <div className="tasks">
      <div className="tasks-head">
        <div>
          <h3>Welcome to {guild.name}</h3>
          {home?.updatedAt && (
            <span className="muted">
              Last edited {formatWhen(home.updatedAt, timezone)}
              {home.updatedBy ? ` by ${home.updatedBy}` : ''}
            </span>
          )}
        </div>
        {guild.isOfficer && (
          <Link className="btn" to={guildPath(guild, 'edit')}>
            {home?.markdown ? 'Edit' : 'Write a welcome post'}
          </Link>
        )}
      </div>
      {error ? (
        <p className="status-error">{error}</p>
      ) : !home ? (
        <p className="empty">Loading…</p>
      ) : home.markdown ? (
        <MarkdownView text={home.markdown} />
      ) : (
        <p className="empty">
          {guild.isOfficer
            ? 'No welcome post yet. Write one to greet your members: it shows here for everyone in the guild.'
            : 'There is no welcome post yet.'}
        </p>
      )}
    </div>
  );
}

/** `edit`: Officers write the welcome post, with the same editor as in Settings. */
export function HomeEditPage({ guild }: { guild: Guild }) {
  const navigate = useNavigate();
  const { home, error } = useHome(guild.id);

  if (error) return <p className="status-error tasks">{error}</p>;
  if (!home) return <p className="empty">Loading…</p>;

  return (
    <div className="tasks">
      <div className="tasks-head">
        <h3>Welcome post</h3>
      </div>
      <WelcomeEditor
        guildId={guild.id}
        guildName={guild.name}
        initial={home.markdown ?? ''}
        onSaved={() => navigate(guildPath(guild))}
        onCancel={() => navigate(guildPath(guild))}
      />
    </div>
  );
}
