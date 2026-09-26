import { useState, type FormEvent } from 'react';
import { createTask, fetchPeople, fetchRoleOptions, updateTask } from './api';
import { channelKey, splitChannelKey } from './channelKey';
import { ChannelSelect } from './ChannelSelect';
import { DiscordMarkdown, type MentionNames } from './DiscordMarkdown';
import { formatWhen } from './time';
import type { Guild, ScheduledPost, ServerChannels } from './types';

interface Props {
  guild: Guild;
  channels: ServerChannels[];
  /** When set the form edits this post instead of creating one. */
  editing?: ScheduledPost;
  timezone: string;
  onSaved: () => void;
  onCancel: () => void;
}

const MAX_LENGTH = 2000;

const emptyNames = (): MentionNames => ({
  users: new Map(),
  roles: new Map(),
  channels: new Map(),
});

/**
 * A post is sent once, as one message. While that message is in Discord, saving edits it in
 * place; the date only matters until it has been sent.
 */
export function PostTaskForm({ guild, channels, editing, timezone, onSaved, onCancel }: Props) {
  const live = Boolean(editing?.post.posted && !editing.post.posted.messageDeleted);
  const [name, setName] = useState(editing?.name ?? '');
  const [channel, setChannel] = useState(
    editing ? channelKey(editing.post.serverId, editing.post.channelId) : '',
  );
  const [runAtLocal, setRunAtLocal] = useState(editing?.schedule.runAtLocal ?? '');
  const [content, setContent] = useState(editing?.post.content ?? '');
  const [reactions, setReactions] = useState(editing?.post.seedReactions.join(' ') ?? '');
  const [embedLinks, setEmbedLinks] = useState(editing?.post.embedLinks ?? true);
  const [preview, setPreview] = useState(false);
  const [names, setNames] = useState<MentionNames>(emptyNames);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePreview = () => {
    if (!preview) {
      // Look up names for mentions the first time the preview opens; failures just show generic names.
      void Promise.allSettled([fetchPeople(guild.id), fetchRoleOptions(guild.id)]).then(
        ([people, roles]) => {
          const next = emptyNames();
          if (people.status === 'fulfilled') {
            for (const person of people.value.people) {
              next.users.set(
                person.discordUserId,
                person.displayName ?? person.username ?? person.discordUserId,
              );
            }
          }
          if (roles.status === 'fulfilled') {
            for (const role of roles.value) next.roles.set(role.id, role.name);
          }
          for (const group of channels) {
            for (const c of group.channels) next.channels.set(c.id, c.name);
          }
          setNames(next);
        },
      );
    }
    setPreview((current) => !current);
  };

  const submit = (postNow: boolean) => {
    setError(null);
    const { serverId, channelId } = splitChannelKey(channel);
    const input = {
      name: name.trim(),
      serverId,
      channelId,
      content,
      seedReactions: reactions.split(/[\s,]+/).filter(Boolean),
      embedLinks,
      // A post that is live keeps its message: its date and "post now" no longer apply.
      ...(live ? {} : postNow ? { postNow: true } : { runAtLocal }),
    };
    setBusy(true);
    (editing ? updateTask(editing.id, input) : createTask(guild.id, input))
      .then(() => onSaved())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(false);
  };

  return (
    <form className="card-body task-form" onSubmit={handleSubmit}>
      <h3>{editing ? 'Edit post' : 'New post'}</h3>
      <div className="form-grid form-grid-3">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <div className="field">
          Channel
          <ChannelSelect groups={channels} value={channel} onChange={setChannel} required />
        </div>
        {live ? (
          <div className="field">
            Posted
            <input
              value={formatWhen(editing?.lastRunAt ?? null, timezone)}
              disabled
              aria-label="When it was posted"
            />
          </div>
        ) : (
          <label className="field">
            Post at ({timezone})
            <input
              type="datetime-local"
              value={runAtLocal}
              onChange={(e) => setRunAtLocal(e.target.value)}
              required
            />
          </label>
        )}
      </div>

      <div className="field task-text">
        <span className="task-text-head">
          Post (Discord markdown)
          <span className={content.length > MAX_LENGTH ? 'status-error' : 'muted'}>
            {content.length}/{MAX_LENGTH}
          </span>
        </span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={7}
          required
          maxLength={MAX_LENGTH + 500}
        />
        <details className="syntax-help">
          <summary title="Show who reacted to a message inside this post">
            ⓘ Show who reacted (live tags)
          </summary>

          <h5>What it does</h5>
          <p>
            Put a tag in the text and the bot replaces it with the people who reacted to a message,
            then keeps it up to date (within a minute of a reaction changing).
          </p>
          <pre className="md-code">
            {'Signed up: {{reactions sourcePost=123456789012345678 emoji=👍}}'}
          </pre>

          <h5>The three options</h5>
          <table className="syntax-table">
            <tbody>
              <tr>
                <th>
                  <code>sourcePost</code>
                </th>
                <td>
                  The message to read. Use its <strong>message id</strong> (Discord: right-click the
                  message → Copy Message ID), or its <strong>link</strong> (Copy Message Link), or
                  the <strong>name</strong> of a scheduled post. Leave it out to read this post.
                </td>
              </tr>
              <tr>
                <th>
                  <code>emoji</code>
                </th>
                <td>
                  Which reaction to list: 👍, or a server emoji as <code>&lt;:name:id&gt;</code>.
                </td>
              </tr>
              <tr>
                <th>
                  <code>show</code>
                </th>
                <td>
                  What to write, as a JavaScript expression (see below). Leave it out to list the
                  names. Put it in quotes when it has spaces.
                </td>
              </tr>
            </tbody>
          </table>

          <h5>
            What <code>show</code> can use: <code>reactions</code>
          </h5>
          <p>
            <code>reactions</code> is a <strong>list</strong> (an array) with one entry for each
            person who reacted. Each entry is an <strong>object</strong> with these fields:
          </p>
          <table className="syntax-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>id</code>
                </td>
                <td>text</td>
                <td>Their Discord user id.</td>
              </tr>
              <tr>
                <td>
                  <code>tag</code>
                </td>
                <td>text</td>
                <td>A mention of them, like @Ana. Nobody gets pinged.</td>
              </tr>
              <tr>
                <td>
                  <code>name</code>
                </td>
                <td>text</td>
                <td>Their Discord name.</td>
              </tr>
              <tr>
                <td>
                  <code>displayName</code>
                </td>
                <td>text</td>
                <td>Their nickname in the message's server (their Discord name if none).</td>
              </tr>
              <tr>
                <td>
                  <code>mainName</code>
                </td>
                <td>text</td>
                <td>Their main character(s), like Merric / Olga (their Discord name if none).</td>
              </tr>
              <tr>
                <td>
                  <code>mains</code>
                </td>
                <td>list of text</td>
                <td>Their main characters, one entry each (empty if none).</td>
              </tr>
            </tbody>
          </table>
          <p>
            The result can be text or a list (a list is joined with commas). Put the expression in
            quotes: <code>show="…"</code>.
          </p>

          <h5>Examples</h5>
          <table className="syntax-table">
            <tbody>
              <tr>
                <td>
                  <code>show="reactions.length"</code>
                </td>
                <td>How many: 3</td>
              </tr>
              <tr>
                <td>
                  <code>show="reactions.map(r =&gt; r.mainName)"</code>
                </td>
                <td>Main characters: Merric, Bruno</td>
              </tr>
              <tr>
                <td>
                  <code>show="reactions.map(r =&gt; r.tag)"</code>
                </td>
                <td>Mentions: @Ana, @Bruno</td>
              </tr>
              <tr>
                <td>
                  <code>{'show="`${reactions.length}: ${reactions.map(r => r.name)}`"'}</code>
                </td>
                <td>A count and the names: 2: Ana,Bruno</td>
              </tr>
            </tbody>
          </table>
          <p className="muted">
            The expression runs in a safe sandbox (no files or network) and is checked when you
            save. If you need a double quote inside it, write <code>\"</code>, or use single quotes.
          </p>
        </details>
        <div className="task-text-actions">
          <button type="button" className="btn btn-sm" onClick={togglePreview}>
            {preview ? 'Hide preview' : 'Preview'}
          </button>
          {live && (
            <span className="muted">
              This post is in Discord: saving edits that message right away. To post it again,
              delete it first.
            </span>
          )}
        </div>
        {preview && (
          <>
            <DiscordMarkdown text={content} names={names} />
            {/https?:\/\//.test(content) && (
              <p className="muted">
                {embedLinks
                  ? 'Discord will also show a preview card under the links (not shown here).'
                  : 'Link previews are off: Discord will show the links as plain text only.'}
              </p>
            )}
          </>
        )}
      </div>

      <div className="form-grid">
        <label className="field field-span-2">
          Reactions to add (optional)
          <input
            value={reactions}
            placeholder="👍 👎"
            onChange={(e) => setReactions(e.target.value)}
          />
        </label>
        <div className="field">
          Embedded links
          <label className="field-toggle">
            <input
              type="checkbox"
              checked={embedLinks}
              onChange={(e) => setEmbedLinks(e.target.checked)}
            />
            Show embedded links
          </label>
        </div>
      </div>

      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : live ? 'Save changes' : editing ? 'Save' : 'Schedule post'}
        </button>
        {!live && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            title="Sends it to Discord right away instead of at the chosen time."
            onClick={() => submit(true)}
          >
            {editing ? 'Save and post now' : 'Post now'}
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
