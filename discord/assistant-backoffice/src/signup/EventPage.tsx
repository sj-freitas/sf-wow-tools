import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DiscordMarkdown } from '../DiscordMarkdown';
import { ArchiveIcon, CalendarIcon, ClockIcon, LockIcon, MailIcon, PinIcon } from '../Icons';
import { subscribeEvents } from '../events';
import { guildPath } from '../guildPath';
import { SkeletonLines } from '../Loading';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import { AssignmentsTab } from './AssignmentsTab';
import { ROLE_NAME, STATUS_LABELS, errorText, formatEventTime, zoneLabel } from './labels';
import { EventFormPage } from './EventFormPage';
import { MissingTab } from './MissingTab';
import { SetupEditor } from './SetupEditor';
import {
  archiveEvent,
  deleteEvent,
  fetchEvent,
  publishEvent,
  restoreEvent,
  setEventLock,
  type SignupEvent,
} from './signupApi';
import { SignupDrawer, type DrawerTarget } from './SignupDrawer';
import { SignupLists } from './SignupLists';
import { StatusIcon } from './StatusIcon';
import { Select } from '../Select';

type Tab = 'signups' | 'setup' | 'assignments' | 'missing';

const NO_NAMES = { users: new Map(), roles: new Map(), channels: new Map() };

/**
 * `/signup/:eventId`: one event, with its tabs. Updates live as people sign up in Discord. Its
 * organisers see its details as a form they edit right there (saved with Save, enabled once
 * something changed); everyone else, and an archived event, sees them read-only.
 */
export function EventPage({ guild }: { guild: Guild }) {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [event, setEvent] = useState<SignupEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

  const load = useCallback(
    () =>
      fetchEvent(guild.id, eventId)
        .then((value) => {
          setEvent(value);
          setError(null);
        })
        .catch((err: unknown) => setError(errorText(err))),
    [guild.id, eventId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => subscribeEvents('signup', () => void load()), [load]);

  const requested = (params.get('tab') ?? 'signups') as Tab;
  // Archived events are read-only: nothing to organise.
  const organize = (event?.permissions.canOrganize ?? false) && !event?.archivedAt;
  const unavailable =
    (!organize && (requested === 'setup' || requested === 'missing')) ||
    (requested === 'assignments' && event?.layout.hasAssignments === false);
  const tab: Tab = unavailable ? 'signups' : requested;
  const selectTab = (value: Tab) =>
    setParams(value === 'signups' ? {} : { tab: value }, { replace: true });
  // The sections this viewer has, in order.
  const tabs: [Tab, string][] = [
    ['signups', 'Sign-ups'],
    ...(organize ? [['setup', event?.layout.setupTitle ?? 'Raid setup'] as [Tab, string]] : []),
    ...(event?.layout.hasAssignments ? [['assignments', 'Assignments'] as [Tab, string]] : []),
    ...(organize ? [['missing', 'Not signed up'] as [Tab, string]] : []),
  ];

  const act = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(load)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  if (!event) {
    return error ? (
      <div className="card-body">
        <p className="status-error">{error}</p>
        <Link to={guildPath(guild, 'signup')}>← Events</Link>
      </div>
    ) : (
      <div className="card-body">
        <SkeletonLines count={6} />
      </div>
    );
  }

  const archived = event.archivedAt !== null;
  // What the tabs get: an archived event as if nobody could change anything, so every edit
  // control stays hidden (the API refuses changes to archived events too).
  const shown: SignupEvent = archived
    ? { ...event, permissions: { canManage: false, canOrganize: false, isOfficer: false } }
    : event;

  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lockLabel =
    event.lockMode === 'AUTO'
      ? event.closed
        ? 'Closed (the event has started)'
        : 'Open until the event starts'
      : event.lockMode === 'LOCKED'
        ? 'Locked by hand'
        : 'Unlocked by hand';
  // Lock, unlock and archive: in the form's row, next to Save.
  const manageButtons = (
    <>
      {event.lockMode !== 'LOCKED' && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => act(() => setEventLock(guild.id, event.id, 'LOCKED'))}
        >
          Lock
        </button>
      )}
      {event.closed && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => act(() => setEventLock(guild.id, event.id, 'UNLOCKED'))}
        >
          Unlock
        </button>
      )}
      {event.lockMode !== 'AUTO' && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          title="Open until the event starts, closed after"
          onClick={() => act(() => setEventLock(guild.id, event.id, 'AUTO'))}
        >
          Lock automatically
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-danger"
        disabled={busy}
        onClick={() =>
          void confirm({
            title: 'Archive this event?',
            message:
              'The bot removes its post, raid setup and assignments from Discord. The event, its sign-ups, setup and assignments are kept under Archived, where it can be restored.',
            confirmLabel: 'Archive event',
            danger: true,
          }).then((ok) => ok && act(() => archiveEvent(guild.id, event.id)))
        }
      >
        Archive event
      </button>
    </>
  );
  const byLine = (
    <>
      By{' '}
      <a
        href={`https://discord.com/users/${event.createdByDiscordId}`}
        target="_blank"
        rel="noreferrer"
      >
        {event.createdByName}
      </a>{' '}
      · {lockLabel}
      {event.postUrl ? (
        <>
          {' · '}
          <a href={event.postUrl} target="_blank" rel="noreferrer">
            Open in Discord
          </a>
        </>
      ) : null}
    </>
  );

  return (
    <div className="signup-event">
      {dialog}
      <div className="card-body signup-event-head">
        <Link className="back-link" to={guildPath(guild, 'signup')}>
          ← Events
        </Link>
        <div className="signup-event-title">
          <h3>{event.title}</h3>
          <span className={event.closed ? 'badge' : 'badge badge-main'}>
            {event.publishAt ? (
              <>
                <ClockIcon /> Scheduled
              </>
            ) : event.closed ? (
              <>
                <LockIcon /> Closed
              </>
            ) : (
              'Open'
            )}
          </span>
        </div>
        {event.permissions.canManage && !archived ? (
          <>
            <p className="muted">{byLine}</p>
            <EventFormPage
              guild={guild}
              serverTimezone={event.serverTimezone}
              eventId={event.id}
              onSaved={() => void load()}
              actions={manageButtons}
            />
          </>
        ) : (
          <>
            {event.location && (
              <p className="signup-when">
                <PinIcon /> {event.location}
              </p>
            )}
            <p className="signup-when">
              <CalendarIcon /> {formatEventTime(event.startsAt, event.timezone)}{' '}
              <span className="muted">{zoneLabel(event.timezone, event.serverTimezone)}</span>
              {localZone !== event.timezone && (
                <span className="muted">
                  {' '}
                  · {formatEventTime(event.startsAt, localZone)} your time
                </span>
              )}
            </p>
            {event.inviteTime && (
              <p className="signup-when">
                <MailIcon /> Invites from {event.inviteTime}
              </p>
            )}
            <p className="muted">{byLine}</p>
            {event.description && (
              <div className="signup-description">
                <DiscordMarkdown text={event.description} names={NO_NAMES} />
              </div>
            )}
          </>
        )}

        {event.publishAt && (
          <div className="banner signup-archived">
            <span>
              <ClockIcon /> Scheduled: the post goes out{' '}
              {formatEventTime(event.publishAt, event.timezone)}. Until then only organisers see
              this event, and sign-ups are closed.
              {event.publishError && (
                <span className="status-error">
                  {' '}
                  The last try failed: {event.publishError} It is tried again every minute.
                </span>
              )}
            </span>
            {event.permissions.canManage && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => act(() => publishEvent(guild.id, event.id))}
              >
                Post now
              </button>
            )}
          </div>
        )}
        {archived && (
          <div className="banner signup-archived">
            <span>
              <ArchiveIcon /> Archived {formatEventTime(event.archivedAt!, event.timezone)}: kept as
              history, read-only, and no longer in Discord.
            </span>
          </div>
        )}

        {event.permissions.canManage &&
          (archived ? (
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => act(() => restoreEvent(guild.id, event.id))}
              >
                Restore and post again
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() =>
                  void confirm({
                    title: 'Delete this event for good?',
                    message:
                      'Its sign-ups, setup and assignments are deleted and can’t be brought back.',
                    confirmLabel: 'Delete for good',
                    danger: true,
                  }).then(
                    (ok) =>
                      ok &&
                      act(() =>
                        deleteEvent(guild.id, event.id).then(() =>
                          navigate(guildPath(guild, 'signup')),
                        ),
                      ),
                  )
                }
              >
                Delete for good
              </button>
            </div>
          ) : null)}
        {error && <p className="status-error">{error}</p>}
      </div>

      {/* The event's sections: tabs, or on a phone (where four tabs wrap) a dropdown, like the
          guild's own sections. */}
      <nav className="view-tabs wide-only" role="tablist" aria-label="Event sections">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-selected={tab === value}
            onClick={() => selectTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="event-tabs-select phone-only">
        <Select aria-label="Event section" value={tab} onChange={(v) => selectTab(v as Tab)}>
          {tabs.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {tab === 'signups' && (
        <div className="tasks">
          <div className="signup-toolbar">
            <span className="muted">
              {event.mine ? (
                <>
                  You: <StatusIcon status={event.mine.status} /> {STATUS_LABELS[event.mine.status]}
                  {event.mine.characterName &&
                    ` as ${event.mine.characterName}${
                      event.mine.role ? ` (${ROLE_NAME[event.mine.role]})` : ''
                    }`}
                </>
              ) : (
                'You haven’t answered yet.'
              )}
              {event.closed && ' Sign-ups are closed.'}
            </span>
            <div className="settings-actions">
              {!event.closed && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setDrawer({ kind: 'self' })}
                >
                  {event.mine ? 'Change my sign-up' : 'Sign up'}
                </button>
              )}
              {/* Signing up someone else: Officers only (not the event's owner). */}
              {shown.permissions.isOfficer && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDrawer({ kind: 'someone', entry: null })}
                >
                  + Sign up a player
                </button>
              )}
            </div>
          </div>
          <SignupLists guild={guild} event={shown} onChanged={load} onEdit={setDrawer} />
        </div>
      )}
      {drawer && (
        <SignupDrawer
          guild={guild}
          event={shown}
          target={drawer}
          onClose={() => setDrawer(null)}
          onSaved={() => void load()}
        />
      )}
      {tab === 'setup' && organize && <SetupEditor guild={guild} event={shown} onChanged={load} />}
      {tab === 'assignments' && event.layout.hasAssignments && (
        <AssignmentsTab guild={guild} event={shown} onChanged={load} />
      )}
      {tab === 'missing' && organize && <MissingTab guild={guild} event={shown} />}
    </div>
  );
}
