import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchRoleOptions } from '../api';
import { channelKey, splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { subscribeEvents } from '../events';
import { guildPath } from '../guildPath';
import { InlineSpinner, SkeletonLines } from '../Loading';
import type { Guild, RoleOption } from '../types';
import { showToast } from '../toast';
import { useChannels } from '../useChannels';
import { useConfirm } from '../useConfirm';
import { STATUS_EMOJI, STATUS_LABELS, errorText, formatEventTime } from './labels';
import {
  deleteEvent,
  fetchEvents,
  fetchSignupSettings,
  saveSignupSettings,
  type EventSummary,
  type EventsView,
  type SignupSettings,
} from './signupApi';
import { Select } from '../Select';

/** `/signup`: the guild's events, newest coming first, and (for those who may) its settings. */
export function EventsPage({ guild, timezone }: { guild: Guild; timezone: string }) {
  const [settings, setSettings] = useState<SignupSettings | null>(null);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [view, setView] = useState<EventsView>('upcoming');
  // Archived: narrowed by the event's day and words in its name. The name is searched a moment
  // after typing stops.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    fetchSignupSettings(guild.id)
      .then(setSettings)
      .catch((err: unknown) => setError(errorText(err)));
    fetchEvents(guild.id, view, view === 'archived' ? { from, to, q: search } : {})
      .then((value) => {
        setEvents(value);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [guild.id, view, from, to, search]);

  useEffect(() => {
    setEvents(null);
    load();
  }, [load]);
  useEffect(() => subscribeEvents('signup', load), [load]);

  // Archived events can be deleted for good right from the list.
  const deleteForGood = (event: EventSummary) =>
    void confirm({
      title: `Delete “${event.title}” for good?`,
      message: 'Its sign-ups, setup and assignments are deleted and can’t be brought back.',
      confirmLabel: 'Delete for good',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      setDeleting(event.id);
      deleteEvent(guild.id, event.id)
        .then(() => {
          setEvents((current) => current?.filter((e) => e.id !== event.id) ?? null);
          showToast('Event deleted');
        })
        .catch((err: unknown) => setError(errorText(err)))
        .finally(() => setDeleting(null));
    });

  return (
    <div className="tasks">
      {dialog}
      <div className="tasks-head">
        <div>
          <h3>Events</h3>
          <span className="muted">
            Members sign up from the event’s post in Discord, or here. Times are in server time (
            {timezone}) unless an event says otherwise.
          </span>
        </div>
        {settings?.canCreate && (
          <Link className="btn btn-primary" to={guildPath(guild, 'signup/create')}>
            + Event
          </Link>
        )}
      </div>

      {error && <p className="status-error">{error}</p>}

      <div className="signup-segments" role="tablist">
        {(
          [
            ['upcoming', 'Upcoming'],
            ['past', 'Past'],
            ['archived', 'Archived'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-selected={view === value}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'archived' && (
        <div className="signup-filters">
          <label className="field">
            From
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="field signup-filter-search">
            Name or Discord post
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Naxxramas, or a post id or link"
            />
          </label>
          {(from || to || query) && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setFrom('');
                setTo('');
                setQuery('');
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {events === null ? (
        <SkeletonLines count={4} />
      ) : events.length === 0 ? (
        <p className="empty">
          {view === 'past' && 'No past events.'}
          {view === 'upcoming' && 'No upcoming events.'}
          {view === 'upcoming' &&
            settings?.canCreate &&
            ' Create one here, or with /create-event in Discord.'}
          {view === 'archived' &&
            (from || to || search
              ? 'No archived events match.'
              : 'No archived events. An event is archived with “Archive event”, or when its post is deleted in Discord.')}
        </p>
      ) : (
        <div className="signup-event-list">
          {events.map((event) => (
            <div key={event.id} className="signup-event-row">
              <Link className="signup-event-card" to={guildPath(guild, `signup/${event.id}`)}>
                <div className="signup-event-card-head">
                  <strong>{event.title}</strong>
                  {event.kind === 'MEMBERS' && <span className="badge">Members</span>}
                  {event.publishAt ? (
                    <span className="badge">
                      🕒 Scheduled · posts {formatEventTime(event.publishAt, event.timezone)}
                    </span>
                  ) : event.archivedAt ? (
                    <span className="badge">Archived</span>
                  ) : (
                    event.closed && <span className="badge">Closed</span>
                  )}
                  {event.myStatus && (
                    <span className="badge badge-main">
                      {STATUS_EMOJI[event.myStatus]} {STATUS_LABELS[event.myStatus]}
                    </span>
                  )}
                </div>
                <span className="muted">
                  {formatEventTime(event.startsAt, event.timezone)}
                  {event.location && ` · 📍 ${event.location}`} · by {event.createdByName}
                </span>
                <span className="signup-counts">
                  {(['AVAILABLE', 'LATE', 'TENTATIVE', 'ABSENT'] as const).map((status) => (
                    <span key={status} title={STATUS_LABELS[status]}>
                      {STATUS_EMOJI[status]} {event.counts[status]}
                    </span>
                  ))}
                </span>
              </Link>
              {event.archivedAt && event.canManage && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger signup-event-delete"
                  disabled={deleting === event.id}
                  onClick={() => deleteForGood(event)}
                >
                  {deleting === event.id ? <InlineSpinner label="Deleting…" /> : 'Delete'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {settings?.canConfigure && <SettingsCard guild={guild} settings={settings} onSaved={load} />}
    </div>
  );
}

/** The event channel and the EventCreator role. Guild-Assistants and Officers. */
function SettingsCard({
  guild,
  settings,
  onSaved,
}: {
  guild: Guild;
  settings: SignupSettings;
  onSaved: () => void;
}) {
  const { channels } = useChannels(guild.id);
  const [roles, setRoles] = useState<RoleOption[] | null>(null);
  const [channel, setChannel] = useState(
    settings.channel ? channelKey(settings.channel.serverId, settings.channel.channelId) : '',
  );
  const [roleId, setRoleId] = useState(settings.eventCreatorRole?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    fetchRoleOptions(guild.id)
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [guild.id]);

  const save = () => {
    setSaving(true);
    setMessage(null);
    saveSignupSettings(guild.id, {
      channel: channel ? splitChannelKey(channel) : null,
      eventCreatorRoleId: roleId || null,
    })
      .then(() => {
        setMessage({ error: false, text: 'Saved.' });
        onSaved();
      })
      .catch((err: unknown) => setMessage({ error: true, text: errorText(err) }))
      .finally(() => setSaving(false));
  };

  return (
    <details className="task-card signup-settings" open={!settings.channel}>
      <summary>
        <strong>Sign-up settings</strong>
      </summary>
      <div className="form-grid">
        <label className="field">
          Event channel
          <ChannelSelect
            groups={channels}
            value={channel}
            onChange={setChannel}
            check={{ guildId: guild.id, use: 'post' }}
          />
          <small>
            Where events are posted. Officers can pick another channel per event; EventCreators
            always post here.
          </small>
        </label>
        <label className="field">
          EventCreator role
          <Select value={roleId} onChange={(v) => setRoleId(v)}>
            <option value="">None (Officers only)</option>
            {settings.eventCreatorRole &&
              !roles?.some((role) => role.id === settings.eventCreatorRole?.id) && (
                <option value={settings.eventCreatorRole.id}>
                  {settings.eventCreatorRole.name}
                </option>
              )}
            {(roles ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
          <small>
            A role in the main server whose members can create events and run their own (raid setup,
            assignments, reminders). Officers can do this for every event.
          </small>
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? <InlineSpinner label="Saving…" /> : 'Save settings'}
        </button>
        {message && (
          <span className={message.error ? 'status-error' : 'muted'}>{message.text}</span>
        )}
      </div>
    </details>
  );
}
