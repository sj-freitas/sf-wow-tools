import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchHome, saveHome } from './api';
import { MarkdownView } from './MarkdownView';
import { formatWhen } from './time';
import type { Guild, GuildHome } from './types';

const MAX_LENGTH = 10_000;

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
          <Link className="btn" to="/edit">
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

/** Officers write the welcome post in markdown, with a live preview. */
export function HomeEditPage({ guild }: { guild: Guild }) {
  const navigate = useNavigate();
  const { home, error: loadError } = useHome(guild.id);
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (home && text === null) setText(home.markdown ?? '');
  }, [home, text]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    saveHome(guild.id, text ?? '')
      .then(() => navigate('/'))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setSaving(false);
      });
  };

  if (loadError) return <p className="status-error tasks">{loadError}</p>;
  if (text === null) return <p className="empty">Loading…</p>;

  return (
    <form className="tasks" onSubmit={submit}>
      <div className="tasks-head">
        <div>
          <h3>Welcome post</h3>
          <span className="muted">
            Markdown: headings, **bold**, lists, links, tables and more. Everyone in the guild sees
            it.
          </span>
        </div>
      </div>
      <div className="home-editor">
        <div className="field">
          <span className="task-text-head">
            Write
            <span className={text.length > MAX_LENGTH ? 'status-error' : 'muted'}>
              {text.length}/{MAX_LENGTH}
            </span>
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            placeholder={`# Welcome to ${guild.name}\n\nSay hello, share the rules, when we raid…`}
          />
        </div>
        <div className="field">
          Preview
          {text.trim() === '' ? (
            <p className="muted">Nothing to preview yet. Saving an empty post removes it.</p>
          ) : (
            <MarkdownView text={text} />
          )}
        </div>
      </div>
      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <Link className="btn" to="/">
          Cancel
        </Link>
      </div>
    </form>
  );
}
