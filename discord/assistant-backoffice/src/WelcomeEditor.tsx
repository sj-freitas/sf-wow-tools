import { useState, type FormEvent } from 'react';
import { saveHome } from './api';
import { MarkdownView } from './MarkdownView';
import type { GuildHome } from './types';

const MAX_LENGTH = 10_000;

interface Props {
  guildId: string;
  guildName: string;
  /** The current welcome post ('' when there is none). */
  initial: string;
  onSaved: (home: GuildHome) => void;
  onCancel?: () => void;
}

/**
 * Writes the guild's welcome post in markdown, with the same Preview toggle as the Discord
 * posts. Saving an empty text removes the post. Used on the home editor and in Settings.
 */
export function WelcomeEditor({ guildId, guildName, initial, onSaved, onCancel }: Props) {
  const [text, setText] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    saveHome(guildId, text)
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  return (
    <form onSubmit={submit}>
      <div className="field task-text">
        <span className="task-text-head">
          Welcome post (markdown)
          <span className={text.length > MAX_LENGTH ? 'status-error' : 'muted'}>
            {text.length}/{MAX_LENGTH}
          </span>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder={`# Welcome to ${guildName}\n\nSay hello, share the rules, when we raid…`}
        />
        <div className="task-text-actions">
          <button type="button" className="btn btn-sm" onClick={() => setPreview((p) => !p)}>
            {preview ? 'Hide preview' : 'Preview'}
          </button>
          <span className="muted">
            Headings, **bold**, lists, links, tables and more. Everyone in the guild sees it.
          </span>
        </div>
        {preview &&
          (text.trim() === '' ? (
            <p className="muted">Nothing to preview yet. Saving an empty post removes it.</p>
          ) : (
            <MarkdownView text={text} />
          ))}
      </div>
      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save welcome post'}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
