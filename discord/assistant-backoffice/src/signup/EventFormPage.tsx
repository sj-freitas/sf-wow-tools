import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { channelKey, splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { guildPath } from '../guildPath';
import { InlineSpinner, Spinner } from '../Loading';
import type { Guild } from '../types';
import { useChannels } from '../useChannels';
import { errorText } from './labels';
import {
  createEvent,
  fetchEvent,
  fetchSignupSettings,
  updateEvent,
  type EventKind,
  type SignupSettings,
} from './signupApi';

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 2000;

/** Every IANA zone the browser knows (most do), for events not in server time. */
function allTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? ['UTC'];
}

/** `/signup/create` and `/signup/:eventId/edit`. The channel is only chosen when creating. */
export function EventFormPage({ guild, serverTimezone }: { guild: Guild; serverTimezone: string }) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const editing = eventId !== undefined;
  const [settings, setSettings] = useState<SignupSettings | null>(null);
  const [loaded, setLoaded] = useState(!editing);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('20:00');
  const [timezone, setTimezone] = useState('ST');
  const [channel, setChannel] = useState('');
  const [kind, setKind] = useState<EventKind>('CHARACTERS');
  // When the post goes out: now, or later (date and time in the event's timezone). Editing shows
  // it only for an event that is still scheduled.
  const [postLater, setPostLater] = useState(false);
  const [canSchedule, setCanSchedule] = useState(!editing);
  const [publishDate, setPublishDate] = useState('');
  const [publishTime, setPublishTime] = useState('18:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(allTimezones, []);

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
        setTitle(event.title);
        setDescription(event.description);
        setLocation(event.location);
        setDate(event.local.date);
        setTime(event.local.time);
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
      title,
      description,
      location,
      date,
      time,
      timezone,
      ...(!editing && settings?.isOfficer && channel ? { channel: splitChannelKey(channel) } : {}),
      ...(!editing ? { type: kind } : {}),
      ...(canSchedule && postLater ? { publishDate, publishTime } : {}),
    };
    const saved = eventId
      ? updateEvent(guild.id, eventId, form).then(() => eventId)
      : createEvent(guild.id, form).then((created) => created.id);
    saved
      .then((id) => navigate(guildPath(guild, `signup/${id}`)))
      .catch((err: unknown) => {
        setError(errorText(err));
        setSaving(false);
      });
  };

  if (!loaded || !settings) return error ? <p className="status-error">{error}</p> : <Spinner />;

  return (
    <form className="card-body signup-form" onSubmit={submit}>
      <Link className="back-link" to={back}>
        ← {editing ? 'Back to the event' : 'Events'}
      </Link>
      <h3>{editing ? 'Edit event' : 'New event'}</h3>
      <div className="form-grid">
        {!editing && (
          <label className="field field-wide">
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
              <option value="CHARACTERS">
                Characters: sign up with a character and role (raid groups, assignments)
              </option>
              <option value="MEMBERS">
                Members: sign up as yourself (a list of who is invited)
              </option>
            </select>
            <small>Can’t be changed later.</small>
          </label>
        )}
        <label className="field field-wide">
          Name
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE}
            placeholder="e.g. Molten Core, Warsong Gulch, Guild Meeting"
            required
          />
        </label>
        <label className="field field-wide">
          Location (optional)
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={100}
            placeholder="e.g. Naxxramas, or Goldshire inn"
          />
        </label>
        <label className="field field-wide">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_DESCRIPTION}
            rows={5}
            placeholder="Shown in the post. Discord formatting works (**bold**, lists, links)."
          />
          <small>
            {description.length} / {MAX_DESCRIPTION}
          </small>
        </label>
        <label className="field">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          Time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label className="field">
          Timezone
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="ST">Server time (ST · {serverTimezone})</option>
            <option value="UTC">UTC</option>
            {zones
              .filter((zone) => zone !== 'UTC')
              .map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
          </select>
          <small>Discord shows everyone the time in their own timezone.</small>
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
        <Link className="btn" to={back}>
          Cancel
        </Link>
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
        <ChannelSelect groups={channels} value={value} onChange={onChange} required />
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
