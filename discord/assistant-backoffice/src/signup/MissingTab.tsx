import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { InlineSpinner, SkeletonLines } from '../Loading';
import { timeAgo } from '../time';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import { errorText } from './labels';
import {
  fetchMissing,
  sendReminder,
  type Missing,
  type MissingPerson,
  type SignupEvent,
} from './signupApi';
import { SignupDrawer } from './SignupDrawer';

/**
 * Everyone in the guild's Discord servers who hasn't answered the event, characters or not, with
 * a button to remind them by DM (as often as needed; each reminder is recorded). "Remind all"
 * goes through the list one by one.
 */
export function MissingTab({
  guild,
  event,
  onChanged,
}: {
  guild: Guild;
  event: SignupEvent;
  onChanged: () => Promise<unknown>;
}) {
  const [missing, setMissing] = useState<Missing | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Raiders only" is on unless the address says `raiders=0`, so the filter can be linked to.
  const [params, setParams] = useSearchParams();
  const raidersOnly = params.get('raiders') !== '0';
  const setRaidersOnly = (on: boolean) => {
    const next = new URLSearchParams(params);
    next.set('raiders', on ? '1' : '0');
    setParams(next, { replace: true });
  };
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const stopBulk = useRef(false);
  const [signingUp, setSigningUp] = useState<MissingPerson | null>(null);
  const { confirm, dialog } = useConfirm();

  const answered = event.entries.length;
  const load = useCallback(() => {
    fetchMissing(guild.id, event.id)
      .then(setMissing)
      .catch((err: unknown) => setError(errorText(err)));
  }, [guild.id, event.id]);
  // Reloaded whenever someone answers, so they drop off the list.
  useEffect(load, [load, answered]);

  const shown = (missing?.people ?? []).filter(
    (person) =>
      // Without a Raider role set for the guild there is nothing to filter on.
      (!raidersOnly || !missing?.hasRaiderRole || person.isRaider) &&
      (query.trim() === '' ||
        `${person.name} ${person.characters.join(' ')}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );

  const remind = async (person: MissingPerson): Promise<void> => {
    setSending(person.discordUserId);
    try {
      const result = await sendReminder(guild.id, event.id, person.discordUserId);
      setMissing(
        (current) =>
          current && {
            ...current,
            people: current.people.map((p) =>
              p.discordUserId === person.discordUserId
                ? {
                    ...p,
                    reminders: p.reminders + 1,
                    lastReminderAt: result.sentAt,
                    lastDelivered: result.delivered,
                  }
                : p,
            ),
          },
      );
    } catch (err) {
      setError(errorText(err));
      throw err;
    } finally {
      setSending(null);
    }
  };

  const remindAll = async () => {
    const people = shown;
    const ok = await confirm({
      title: `Remind ${people.length} people?`,
      message:
        'The bot sends each of them a DM with a link to the event, one after the other. You can stop it midway.',
      confirmLabel: 'Send reminders',
    });
    if (!ok) return;
    stopBulk.current = false;
    setBulk({ done: 0, total: people.length });
    for (const [index, person] of people.entries()) {
      if (stopBulk.current) break;
      try {
        await remind(person);
      } catch {
        break;
      }
      setBulk({ done: index + 1, total: people.length });
    }
    setBulk(null);
  };

  if (!missing) {
    return (
      <div className="tasks">
        {error ? <p className="status-error">{error}</p> : <SkeletonLines count={5} />}
      </div>
    );
  }

  return (
    <div className="tasks">
      {dialog}
      <div className="tasks-head">
        <div>
          <strong>{missing.people.length} haven’t answered</strong>
          <div className="muted">
            {missing.source === 'servers'
              ? 'Everyone in the guild’s Discord servers without a sign-up.'
              : 'Discord would not list the servers’ members, so this only shows people with characters in the guild.'}
          </div>
        </div>
        {bulk ? (
          <button type="button" className="btn" onClick={() => (stopBulk.current = true)}>
            <InlineSpinner label={`Reminding ${bulk.done}/${bulk.total}… Stop`} />
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={shown.length === 0 || !event.postUrl || sending !== null}
            onClick={() => void remindAll()}
          >
            Remind all {shown.length}
          </button>
        )}
      </div>
      {!event.postUrl && (
        <p className="status-error">
          {event.publishAt
            ? 'The event isn’t posted yet: reminders can be sent once it is.'
            : 'The event is not in Discord; post it again to send reminders.'}
        </p>
      )}
      {error && <p className="status-error">{error}</p>}

      <div className="signup-filters">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or character"
          aria-label="Search"
        />
        {missing.hasRaiderRole && (
          <label className="field-toggle">
            <input
              type="checkbox"
              checked={raidersOnly}
              onChange={(e) => setRaidersOnly(e.target.checked)}
            />
            Raiders only
          </label>
        )}
      </div>

      {signingUp && (
        <SignupDrawer
          guild={guild}
          event={event}
          target={{
            kind: 'someone',
            entry: null,
            person: { discordUserId: signingUp.discordUserId, name: signingUp.name },
          }}
          onClose={() => setSigningUp(null)}
          onSaved={() => void onChanged()}
        />
      )}

      {shown.length === 0 ? (
        <p className="empty">Nobody here.</p>
      ) : (
        <ul className="signup-people signup-missing">
          {shown.map((person) => (
            <li key={person.discordUserId} className="signup-person">
              {/* A card: who (and Raider), their characters, the reminders, then the actions. */}
              <span className="missing-who">
                <span className="missing-name">
                  <strong>{person.name}</strong>
                  {person.isRaider && <span className="badge">Raider</span>}
                </span>
                <span className="missing-characters muted">
                  {person.characters.length > 0 ? person.characters.join(', ') : 'No characters'}
                </span>
                {person.lastReminderAt && (
                  <span
                    className={
                      person.lastDelivered === false ? 'signup-note status-error' : 'signup-note'
                    }
                  >
                    Reminded {person.reminders}× · last {timeAgo(person.lastReminderAt)}
                    {person.lastDelivered === false && ' (they don’t accept DMs)'}
                  </span>
                )}
              </span>
              <span className="signup-person-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={sending !== null || bulk !== null || !event.postUrl}
                  onClick={() => void remind(person).catch(() => undefined)}
                >
                  {sending === person.discordUserId ? (
                    <InlineSpinner label="Sending…" />
                  ) : person.reminders > 0 ? (
                    'Remind again'
                  ) : (
                    'Remind'
                  )}
                </button>
                {event.permissions.canManage && (
                  <button type="button" className="btn btn-sm" onClick={() => setSigningUp(person)}>
                    Sign up…
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
