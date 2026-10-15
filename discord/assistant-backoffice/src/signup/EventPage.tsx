import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DiscordMarkdown } from '../DiscordMarkdown';
import { subscribeEvents } from '../events';
import { guildPath } from '../guildPath';
import { SkeletonLines } from '../Loading';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import { AssignmentsTab } from './AssignmentsTab';
import {
  ROLE_NAME,
  STATUS_EMOJI,
  STATUS_LABELS,
  errorText,
  formatEventTime,
  zoneLabel,
} from './labels';
import { MissingTab } from './MissingTab';
import { SetupEditor } from './SetupEditor';
import {
  archiveEvent,
  deleteEvent,
  fetchEvent,
  restoreEvent,
  setEventLock,
  type SignupEvent,
} from './signupApi';
import { SignupDrawer, type DrawerTarget } from './SignupDrawer';
import { SignupLists } from './SignupLists';

type Tab = 'signups' | 'setup' | 'assignments' | 'missing';

const NO_NAMES = { users: new Map(), roles: new Map(), channels: new Map() };

/** `/signup/:eventId`: one event, with its tabs. Updates live as people sign up in Discord. */
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
            {event.closed ? '🔒 Closed' : 'Open'}
          </span>
        </div>
        <p className="signup-when">
          🗓️ {formatEventTime(event.startsAt, event.timezone)}{' '}
          <span className="muted">{zoneLabel(event.timezone, event.serverTimezone)}</span>
          {localZone !== event.timezone && (
            <span className="muted"> · {formatEventTime(event.startsAt, localZone)} your time</span>
          )}
        </p>
        <p className="muted">
          By {event.createdByName} · {lockLabel}
          {event.postUrl ? (
            <>
              {' · '}
              <a href={event.postUrl} target="_blank" rel="noreferrer">
                Open in Discord
              </a>
            </>
          ) : null}
        </p>
        {event.description && (
          <div className="signup-description">
            <DiscordMarkdown text={event.description} names={NO_NAMES} />
          </div>
        )}

        {archived && (
          <div className="banner signup-archived">
            <span>
              🗄️ Archived {formatEventTime(event.archivedAt!, event.timezone)}: kept as history,
              read-only, and no longer in Discord.
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
          ) : (
            <div className="settings-actions">
              <Link className="btn btn-sm" to={guildPath(guild, `signup/${event.id}/edit`)}>
                Edit
              </Link>
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
            </div>
          ))}
        {error && <p className="status-error">{error}</p>}
      </div>

      <nav className="view-tabs" role="tablist" aria-label="Event sections">
        <button
          type="button"
          aria-selected={tab === 'signups'}
          onClick={() => selectTab('signups')}
        >
          Sign-ups
        </button>
        {organize && (
          <button type="button" aria-selected={tab === 'setup'} onClick={() => selectTab('setup')}>
            {event.layout.setupTitle}
          </button>
        )}
        {event.layout.hasAssignments && (
          <button
            type="button"
            aria-selected={tab === 'assignments'}
            onClick={() => selectTab('assignments')}
          >
            Assignments
          </button>
        )}
        {organize && (
          <button
            type="button"
            aria-selected={tab === 'missing'}
            onClick={() => selectTab('missing')}
          >
            Not signed up
          </button>
        )}
      </nav>

      {tab === 'signups' && (
        <div className="tasks">
          <div className="signup-toolbar">
            <span className="muted">
              {event.mine
                ? `You: ${STATUS_EMOJI[event.mine.status]} ${STATUS_LABELS[event.mine.status]}${
                    event.mine.characterName
                      ? ` as ${event.mine.characterName}${
                          event.mine.role ? ` (${ROLE_NAME[event.mine.role]})` : ''
                        }`
                      : ''
                  }`
                : 'You haven’t answered yet.'}
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
              {shown.permissions.canManage && (
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
      {tab === 'missing' && organize && <MissingTab guild={guild} event={shown} onChanged={load} />}
    </div>
  );
}
