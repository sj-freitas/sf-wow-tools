import { useState, type FormEvent } from 'react';
import { createTask, fetchPeople, fetchRoleOptions, runTaskNow, updateTask } from './api';
import { channelKey, splitChannelKey } from './channelKey';
import { ChannelSelect } from './ChannelSelect';
import { DiscordMarkdown, type MentionNames } from './DiscordMarkdown';
import type { Guild, ScheduledPost, ScheduleKind, ServerChannels } from './types';

interface Props {
  guild: Guild;
  channels: ServerChannels[];
  /** When set the form edits this post instead of creating one. */
  editing?: ScheduledPost;
  timezone: string;
  onSaved: () => void;
  onCancel: () => void;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MAX_LENGTH = 2000;

const emptyNames = (): MentionNames => ({
  users: new Map(),
  roles: new Map(),
  channels: new Map(),
});

export function PostTaskForm({ guild, channels, editing, timezone, onSaved, onCancel }: Props) {
  const [name, setName] = useState(editing?.name ?? '');
  const [channel, setChannel] = useState(
    editing ? channelKey(editing.post.serverId, editing.post.channelId) : '',
  );
  const [kind, setKind] = useState<ScheduleKind>(editing?.schedule.kind ?? 'WEEKLY');
  const [runAtLocal, setRunAtLocal] = useState(editing?.schedule.runAtLocal ?? '');
  const [timeOfDay, setTimeOfDay] = useState(editing?.schedule.timeOfDay ?? '20:00');
  const [weekday, setWeekday] = useState(editing?.schedule.weekday ?? 2);
  const [content, setContent] = useState(editing?.post.content ?? '');
  const [reactions, setReactions] = useState(editing?.post.seedReactions.join(' ') ?? '');
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [forNextRun, setForNextRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [names, setNames] = useState<MentionNames>(emptyNames);
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

  const submit = (thenPostNow: boolean) => {
    setError(null);
    const { serverId, channelId } = splitChannelKey(channel);
    const input = {
      name: name.trim(),
      enabled,
      kind,
      ...(kind === 'ONCE' ? { runAtLocal } : { timeOfDay }),
      ...(kind === 'WEEKLY' ? { weekday } : {}),
      serverId,
      channelId,
      content,
      seedReactions: reactions.split(/[\s,]+/).filter(Boolean),
      // Posting a new message right away makes editing the old one pointless.
      applyOnNextRun: forNextRun || thenPostNow,
    };
    setBusy(true);
    (editing ? updateTask(editing.id, input) : createTask(guild.id, input))
      .then((saved) => (thenPostNow ? runTaskNow(saved.id) : undefined))
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(false);
  };

  const posted = editing?.post.posted && !editing.post.posted.messageDeleted;

  return (
    <form className="card-body task-form" onSubmit={handleSubmit}>
      <h3>{editing ? 'Edit scheduled post' : 'New scheduled post'}</h3>
      <div className="form-grid form-grid-3">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <div className="field">
          Channel
          <ChannelSelect groups={channels} value={channel} onChange={setChannel} required />
        </div>
        <label className="field">
          Repeats
          <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            <option value="ONCE">Once</option>
            <option value="DAILY">Every day</option>
            <option value="WEEKLY">Every week</option>
          </select>
        </label>
        {kind === 'ONCE' && (
          <label className="field">
            Date and time ({timezone})
            <input
              type="datetime-local"
              value={runAtLocal}
              onChange={(e) => setRunAtLocal(e.target.value)}
              required
            />
          </label>
        )}
        {kind === 'WEEKLY' && (
          <label className="field">
            Day
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== 'ONCE' && (
          <label className="field">
            Time ({timezone})
            <input
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              required
            />
          </label>
        )}
        <label className="field">
          Reactions to add (optional)
          <input
            value={reactions}
            placeholder="👍 👎"
            onChange={(e) => setReactions(e.target.value)}
          />
        </label>
        <div className="field">
          Enabled
          <label className="field-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Post on schedule
          </label>
        </div>
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
        <div className="task-text-actions">
          <button type="button" className="btn btn-sm" onClick={togglePreview}>
            {preview ? 'Hide preview' : 'Preview'}
          </button>
          {posted && (
            <span className="muted">
              This post is already in Discord: saving new text updates that message right away.
            </span>
          )}
        </div>
        {preview && <DiscordMarkdown text={content} names={names} />}
      </div>

      {posted && (
        <label
          className="next-run-option"
          title="Normally, saving edits the message that is already in Discord straight away. Tick this to keep the change for the next scheduled post instead: the message in Discord stays as it is until then."
        >
          <input
            type="checkbox"
            checked={forNextRun}
            onChange={(e) => setForNextRun(e.target.checked)}
          />
          Apply the new text at the next scheduled post instead <span aria-hidden="true">ⓘ</span>
        </label>
      )}

      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create post'}
        </button>
        {enabled && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            title="Saves, then posts a new message right away without waiting for the schedule. The next scheduled post is not affected."
            onClick={() => submit(true)}
          >
            {editing ? 'Save and post now' : 'Create and post now'}
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
