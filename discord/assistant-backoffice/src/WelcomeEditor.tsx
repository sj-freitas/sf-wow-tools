import { FormStatus } from './OneLine';
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
 * Writes the guild's welcome post in markdown, with Write and Preview tabs like a post's messages
 * and the bio editor. Saving an empty text removes the post. Used on the home editor and in
 * Settings.
 */
export function WelcomeEditor({ guildId, guildName, initial, onSaved, onCancel }: Props) {
  const [text, setText] = useState(initial);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
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
      {/* Write and Preview take turns in the same place (a preview opening under the text would
          push the buttons down), like the bio editor. */}
      <div className="field task-text">
        <span>Welcome post (markdown)</span>
        <div className="write-tabs" role="tablist">
          {(['write', 'preview'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'write-tab write-tab-active' : 'write-tab'}
              onClick={() => setTab(value)}
            >
              {value === 'write' ? 'Write' : 'Preview'}
            </button>
          ))}
          <span
            className={
              text.length > MAX_LENGTH ? 'status-error write-tabs-count' : 'muted write-tabs-count'
            }
          >
            {text.length}/{MAX_LENGTH}
          </span>
        </div>
        {tab === 'write' ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={`# Welcome to ${guildName}\n\nSay hello, share the rules, when we raid…`}
          />
        ) : (
          <div className="bio-page-card write-preview write-preview-tall">
            {text.trim() === '' ? (
              <p className="muted">Nothing to preview yet. Saving an empty post removes it.</p>
            ) : (
              <MarkdownView text={text} />
            )}
          </div>
        )}
        <span className="muted">Headings, **bold**, lists, links, tables and more.</span>
      </div>
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
      <FormStatus error={error} />
    </form>
  );
}
