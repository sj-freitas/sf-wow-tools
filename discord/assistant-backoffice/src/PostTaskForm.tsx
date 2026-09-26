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
          <summary title="Show who reacted to a post inside its text">
            ⓘ Live tags: show who reacted
          </summary>
          <p>
            Write <code>{'{{reactions post="Raid signup" emoji=👍 show=names}}'}</code> anywhere in
            the text. It is replaced by the people who reacted, and Discord's message updates by
            itself within a minute of a reaction changing.
          </p>
          <ul>
            <li>
              <code>post</code>: which message to read, in any of these ways. The{' '}
              <strong>name</strong> of a scheduled post (case does not matter). The{' '}
              <strong>link</strong> of any message in this guild's servers: right-click it in
              Discord → Copy Message Link (or <strong>Copy link</strong> on a live post on the Posts
              page); the bot must be able to see that channel. Or the message <strong>id</strong> of
              a post the bot made. Leave it out for this post.
            </li>
            <li>
              <code>emoji</code>: 👍, or a server emoji as <code>&lt;:name:id&gt;</code> (type{' '}
              <code>\:emoji:</code> in Discord to get it).
            </li>
            <li>
              <code>show</code> (optional, default <code>names</code>): <code>names</code> Discord
              names · <code>mainNames</code> their main characters, or the Discord name if they have
              none · <code>tags</code> mentions (nobody is pinged) · <code>number</code> how many ·
              or your own JavaScript expression in quotes (below).
            </li>
          </ul>
          <p>
            Put a value with spaces in quotes. Options can come in any order. Example:{' '}
            <code>{'{{reactions post="Raid signup" emoji=👍 show=mainNames}}'}</code>
          </p>
          <p>
            <strong>Your own format:</strong> <code>show</code> can be a JavaScript expression that
            uses <code>reactions</code>, a list of the people who reacted, each with <code>id</code>
            , <code>tag</code> (a mention), <code>name</code>, <code>mainName</code> and{' '}
            <code>mains</code> (a list). It should give text, or a list (joined with commas).
            Example:
          </p>
          <pre className="md-code">
            {
              '{{reactions post="Raid signup" emoji=👍 show="`${reactions.length}: ${reactions.map((a) => `${a.tag} is ${a.mainName}`).join(\', \')}`"}}'
            }
          </pre>
          <p>
            Use single quotes inside the expression (or <code>\"</code> for a double quote). It runs
            in a sandbox: no access to files, the network or anything else, and it stops after a
            tenth of a second. A mistake is refused when you save.
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
