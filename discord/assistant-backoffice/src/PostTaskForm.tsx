import { useState, type FormEvent } from 'react';
import { createTask, fetchPeople, fetchRoleOptions, updateTask } from './api';
import { channelKey, splitChannelKey } from './channelKey';
import { ChannelSelect } from './ChannelSelect';
import type { MentionNames } from './DiscordMarkdown';
import { LiveTagsHelp } from './LiveTagsHelp';
import { MessagePreview, PostPartEditor } from './PostPartEditor';
import { canSwap, draftOf, inputOf, MAX_PARTS, newDraft, type PartDraft } from './postParts';
import { formatWhen } from './time';
import type { Guild, ScheduledPost, ServerChannels } from './types';
import { useConfirm } from './useConfirm';

interface Props {
  guild: Guild;
  channels: ServerChannels[];
  /** When set the form edits this post instead of creating one. */
  editing?: ScheduledPost;
  timezone: string;
  onSaved: () => void;
  onCancel: () => void;
}

const emptyNames = (): MentionNames => ({
  users: new Map(),
  roles: new Map(),
  channels: new Map(),
});

/**
 * A post is one or more messages, sent to a channel in order at the scheduled time. While its
 * messages are in Discord, saving edits them in place; their order is then fixed, new messages go
 * after them, and the date only matters until they have been sent.
 */
export function PostTaskForm({ guild, channels, editing, timezone, onSaved, onCancel }: Props) {
  const live = editing?.post.live ?? false;
  const [name, setName] = useState(editing?.name ?? '');
  const [channel, setChannel] = useState(
    editing ? channelKey(editing.post.serverId, editing.post.channelId) : '',
  );
  const [runAtLocal, setRunAtLocal] = useState(editing?.schedule.runAtLocal ?? '');
  const [parts, setParts] = useState<PartDraft[]>(() =>
    editing ? editing.post.parts.map(draftOf) : [newDraft()],
  );
  const [sequence, setSequence] = useState(false);
  const [names, setNames] = useState<MentionNames | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const change = (index: number, patch: Partial<PartDraft>) =>
    setParts((current) => current.map((part, i) => (i === index ? { ...part, ...patch } : part)));

  const move = (index: number, direction: -1 | 1) =>
    setParts((current) => {
      const other = index + direction;
      if (!canSwap(current, index, other)) return current;
      const next = [...current];
      [next[index], next[other]] = [next[other], next[index]];
      return next;
    });

  const remove = async (index: number) => {
    const part = parts[index];
    if (part.posted) {
      const ok = await confirm({
        title: `Remove message ${index + 1}?`,
        message:
          'It is in Discord: saving deletes that message from the channel (with its reactions). The other messages stay.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
    }
    setParts((current) => current.filter((_, i) => i !== index));
  };

  /** Looks up names for mentions the first time a preview opens; failures show generic names. */
  const loadNames = () => {
    if (names) return;
    setNames(emptyNames());
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
  };

  const submit = (postNow: boolean) => {
    setError(null);
    const { serverId, channelId } = splitChannelKey(channel);
    const input = {
      name: name.trim(),
      serverId,
      channelId,
      parts: parts.map(inputOf),
      // A post that is live keeps its messages: its date and "post now" no longer apply.
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

  const shownNames = names ?? emptyNames();
  const totalWait = parts.reduce(
    (sum, part, i) => sum + (i > 0 && !part.posted ? part.delaySeconds : 0),
    0,
  );

  return (
    <form className="card-body task-form" onSubmit={handleSubmit}>
      {dialog}
      <h3>{editing ? 'Edit post' : 'New post'}</h3>
      <div className="form-grid form-grid-3">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <div className="field">
          Channel
          <ChannelSelect
            groups={channels}
            value={channel}
            onChange={setChannel}
            required
            disabled={live}
          />
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

      {live && (
        <p className="muted">
          This post is in Discord: saving edits its messages right away (text, images and link
          previews). Messages already posted keep their order and no message can be added. To add
          one, move the post to another channel, or post it again, delete it first.
        </p>
      )}

      <div className="parts">
        <div className="parts-head">
          <h4>{parts.length === 1 ? 'Message' : `Messages (${parts.length})`}</h4>
          {parts.length > 1 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                if (!sequence) loadNames();
                setSequence((current) => !current);
              }}
            >
              {sequence ? 'Hide sequence preview' : 'Preview the sequence'}
            </button>
          )}
        </div>
        <p className="muted">
          A post can be several messages, sent one after the other in this order at the scheduled
          time.
        </p>

        <LiveTagsHelp />

        {sequence && parts.length > 1 && (
          <div className="sequence-preview" aria-label="Preview of the whole sequence">
            {parts.map((part, i) => (
              <div key={part.key}>
                {i > 0 && (
                  <div className="sequence-gap muted">
                    {part.delaySeconds > 0 && !part.posted
                      ? `⏱ ${part.delaySeconds} seconds later`
                      : '↓'}
                  </div>
                )}
                <MessagePreview guildId={guild.id} draft={part} names={shownNames} />
              </div>
            ))}
          </div>
        )}

        {parts.map((part, i) => (
          <PostPartEditor
            key={part.key}
            guildId={guild.id}
            index={i}
            count={parts.length}
            draft={part}
            names={shownNames}
            onPreview={loadNames}
            onChange={(patch) => change(i, patch)}
            onMove={(direction) => move(i, direction)}
            canMove={(direction) => canSwap(parts, i, i + direction)}
            onRemove={() => void remove(i)}
          />
        ))}

        <div className="settings-actions">
          <button
            type="button"
            className="btn"
            disabled={parts.length >= MAX_PARTS || live}
            title={live ? 'A post that is in Discord cannot get more messages' : undefined}
            onClick={() => setParts((current) => [...current, newDraft()])}
          >
            + Add message
          </button>
          {totalWait > 0 && <span className="muted">The waits add up to {totalWait} seconds.</span>}
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
