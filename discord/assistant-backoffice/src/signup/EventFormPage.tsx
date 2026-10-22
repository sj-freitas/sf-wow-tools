import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { channelKey, splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { guildPath } from '../guildPath';
import { InlineSpinner, Spinner } from '../Loading';
import type { Guild } from '../types';
import { useChannels } from '../useChannels';
import { TimezoneField } from '../TimezoneField';
import { EventTextFields, type EventText } from './EventFields';
import { errorText } from './labels';
import {
  createEvent,
  fetchEvent,
  fetchSignupSettings,
  updateEvent,
  type SignupSettings,
} from './signupApi';

/**
 * `/signup/create`, and editing an event inside its page (`EventPage`, with `eventId`, `onSaved`
 * and `onCancel`). The channel is only chosen when creating.
 */
export function EventFormPage({
  guild,
  serverTimezone,
  eventId: editedId,
  onSaved,
  onCancel,
}: {
  guild: Guild;
  serverTimezone: string;
  /** Editing this event, inside its page: saving and cancelling go back to its details. */
  eventId?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const params = useParams();
  const eventId = editedId ?? params.eventId;
  const embedded = editedId !== undefined;
  const navigate = useNavigate();
  const editing = eventId !== undefined;
  const [settings, setSettings] = useState<SignupSettings | null>(null);
  const [loaded, setLoaded] = useState(!editing);
  const [text, setText] = useState<EventText>({
    kind: 'CHARACTERS',
    title: '',
    location: '',
    description: '',
  });
  const [date, setDate] = useState('');
  const [time, setTime] = useState('20:00');
  // When raid invites start (optional): shown on the post, and GuildAssistant RaidSort's Auto-Invite uses it.
  const [inviteTime, setInviteTime] = useState('');
  const [timezone, setTimezone] = useState('ST');
  const [channel, setChannel] = useState('');
  // When the post goes out: now, or later (date and time in the event's timezone). Editing shows
  // it only for an event that is still scheduled.
  const [postLater, setPostLater] = useState(false);
  const [canSchedule, setCanSchedule] = useState(!editing);
  const [publishDate, setPublishDate] = useState('');
  const [publishTime, setPublishTime] = useState('18:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSignupSettings(guild.id)
      .then((value) => {
        setSettings(value);
        if (value.channel) setChannel(channelKey(value.channel.serverId, value.channel.channelId));
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [guild.id]);

  useEffect(() => {
    if (!eventId) return;
    fetchEvent(guild.id, eventId)
      .then((event) => {
        setText({
          kind: event.kind,
          title: event.title,
          location: event.location,
          description: event.description,
        });
        setDate(event.local.date);
        setTime(event.local.time);
        setInviteTime(event.inviteTime ?? '');
        setTimezone(event.timezone === event.serverTimezone ? 'ST' : event.timezone);
        if (event.publishLocal) {
          setCanSchedule(true);
          setPostLater(true);
          setPublishDate(event.publishLocal.date);
          setPublishTime(event.publishLocal.time);
        } else {
          setCanSchedule(false);
        }
        setLoaded(true);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [guild.id, eventId]);

  const back = guildPath(guild, editing ? `signup/${eventId}` : 'signup');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = {
      title: text.title,
      description: text.description,
      location: text.location,
      date,
      time,
      timezone,
      inviteTime,
      ...(!editing && settings?.isOfficer && channel ? { channel: splitChannelKey(channel) } : {}),
      ...(!editing ? { type: text.kind } : {}),
      ...(canSchedule && postLater ? { publishDate, publishTime } : {}),
    };
    const saved = eventId
      ? updateEvent(guild.id, eventId, form).then(() => eventId)
      : createEvent(guild.id, form).then((created) => created.id);
    saved
      .then((id) => (onSaved ? onSaved() : navigate(guildPath(guild, `signup/${id}`))))
      .catch((err: unknown) => {
        setError(errorText(err));
        setSaving(false);
      });
  };

  if (!loaded || !settings) return error ? <p className="status-error">{error}</p> : <Spinner />;

  return (
    <form className={embedded ? 'signup-form' : 'card-body signup-form'} onSubmit={submit}>
      {!embedded && (
        <Link className="back-link" to={back}>
          ← {editing ? 'Back to the event' : 'Events'}
        </Link>
      )}
      <h3>{editing ? 'Edit event' : 'New event'}</h3>
      <div className="form-grid">
        <EventTextFields value={text} onChange={setText} showKind={!editing} />
        <label className="field">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          Time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <TimezoneField value={timezone} onChange={setTimezone} serverTimezone={serverTimezone} />
        <label className="field">
          Invites start
          <input type="time" value={inviteTime} onChange={(e) => setInviteTime(e.target.value)} />
          <small className="muted">
            Optional. Before the event, e.g. 15 minutes; shown on the post, and GuildAssistant
            RaidSort can invite from then.
          </small>
        </label>
        {canSchedule && (
          <fieldset className="field field-wide signup-post-when">
            <legend>Post</legend>
            <label className="field-toggle">
              <input
                type="radio"
                name="post-when"
                checked={!postLater}
                disabled={editing}
                onChange={() => setPostLater(false)}
              />
              {editing ? 'Use “Post now” on the event page' : 'Now'}
            </label>
            <label className="field-toggle">
              <input
                type="radio"
                name="post-when"
                checked={postLater}
                onChange={() => setPostLater(true)}
              />
              At a date and time
            </label>
            {postLater && (
              <div className="signup-post-at">
                <input
                  type="date"
                  aria-label="Posting date"
                  value={publishDate}
                  max={date || undefined}
                  onChange={(e) => setPublishDate(e.target.value)}
                  required
                />
                <input
                  type="time"
                  aria-label="Posting time"
                  value={publishTime}
                  onChange={(e) => setPublishTime(e.target.value)}
                  required
                />
              </div>
            )}
            <small>
              {postLater
                ? 'Saved now and posted then, in the same timezone as the event. Until then only organisers see it, and you can keep editing it and prepare its setup and assignments.'
                : 'Posted in Discord as soon as you create it.'}
            </small>
          </fieldset>
        )}
        {!editing && (
          <ChannelField guild={guild} settings={settings} value={channel} onChange={setChannel} />
        )}
      </div>
      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? (
            <InlineSpinner label={editing ? 'Saving…' : 'Posting…'} />
          ) : editing ? (
            'Save'
          ) : postLater ? (
            'Create and schedule'
          ) : (
            'Create and post'
          )}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <Link className="btn" to={back}>
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}

/** Officers pick any channel; everyone else posts in the event channel. */
function ChannelField({
  guild,
  settings,
  value,
  onChange,
}: {
  guild: Guild;
  settings: SignupSettings;
  value: string;
  onChange: (value: string) => void;
}) {
  const { channels, channelName } = useChannels(guild.id);
  if (settings.isOfficer) {
    return (
      <label className="field">
        Channel
        <ChannelSelect
          groups={channels}
          value={value}
          onChange={onChange}
          required
          check={{ guildId: guild.id, use: 'post' }}
        />
        <small>Defaults to the event channel.</small>
      </label>
    );
  }
  return (
    <div className="field">
      Channel
      {settings.channel ? (
        <span className="signup-fixed-value">
          #{channelName(settings.channel.serverId, settings.channel.channelId) ?? 'event channel'}
        </span>
      ) : (
        <span className="status-error">
          No event channel is set. An Officer can set one on the Events page.
        </span>
      )}
    </div>
  );
}
