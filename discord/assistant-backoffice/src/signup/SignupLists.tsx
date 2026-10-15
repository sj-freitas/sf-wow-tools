import { useState } from 'react';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import {
  ROLE_CATEGORIES,
  ROLE_EMOJI,
  STATUS_EMOJI,
  STATUS_LABELS,
  entryName,
  errorText,
} from './labels';
import { ClassMark } from '../ClassMark';
import type { DrawerTarget } from './SignupDrawer';
import {
  removeEntry,
  withdrawMySignup,
  type Entry,
  type SignupEvent,
  type SignupStatus,
} from './signupApi';

const OTHER_STATUSES: SignupStatus[] = ['LATE', 'TENTATIVE', 'ABSENT'];

/** In the order people answered, like the Discord post. */
const bySignup = (a: Entry, b: Entry) => a.createdAt.localeCompare(b.createdAt);

/**
 * Everyone's answers, in the same categories as the Discord post. Organisers see the notes left
 * with Late and Tentative. Change and Remove show on your own sign-up (while the event is open),
 * and on everyone's for Officers.
 */
export function SignupLists({
  guild,
  event,
  onChanged,
  onEdit,
}: {
  guild: Guild;
  event: SignupEvent;
  onChanged: () => Promise<unknown>;
  /** Opens the sign-up drawer. */
  onEdit: (target: DrawerTarget) => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const available = event.entries.filter((entry) => entry.status === 'AVAILABLE').sort(bySignup);
  const officer = event.permissions.isOfficer;
  // Sign-up numbers, as in the Discord post: the order people first answered.
  const numbers = new Map(
    [...event.entries].sort(bySignup).map((entry, index) => [entry.id, index + 1]),
  );

  const isMine = (entry: Entry) => entry.id === event.mine?.id;

  const remove = (entry: Entry) =>
    void confirm(
      isMine(entry) && !officer
        ? {
            title: 'Take back your sign-up?',
            message: 'You can sign up again while the event is open.',
            confirmLabel: 'Take it back',
            danger: true,
          }
        : {
            title: `Remove ${entryName(entry)}?`,
            message: 'Their sign-up is deleted. They can sign up again while the event is open.',
            confirmLabel: 'Remove',
            danger: true,
          },
    ).then((ok) => {
      if (!ok) return;
      (officer ? removeEntry(guild.id, event.id, entry.id) : withdrawMySignup(guild.id, event.id))
        .then(onChanged)
        .catch((err: unknown) => setError(errorText(err)));
    });

  const row = (entry: Entry) => (
    <li key={entry.id} className="signup-person">
      <span>
        {entry.status !== 'AVAILABLE' && entry.role && `${ROLE_EMOJI[entry.role]} `}
        <span className="signup-number">{numbers.get(entry.id)}</span>
        <ClassMark gameVersion={guild.gameVersion} className={entry.characterClass} />
        <strong>{entryName(entry)}</strong>
        {entry.characterName && entry.discordName !== entry.characterName && (
          <span className="muted"> · {entry.discordName}</span>
        )}
        {entry.note && <span className="signup-note">“{entry.note}”</span>}
      </span>
      {(officer || (isMine(entry) && !event.closed)) && (
        <span className="signup-person-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onEdit(isMine(entry) && !officer ? { kind: 'self' } : { kind: 'someone', entry })
            }
          >
            Change
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(entry)}>
            Remove
          </button>
        </span>
      )}
    </li>
  );

  return (
    <>
      {dialog}
      {error && <p className="status-error">{error}</p>}
      {event.layout.usesCharacters ? (
        <div className="signup-columns">
          {ROLE_CATEGORIES.map(({ role, label, emoji }) => {
            const inRole = available.filter((entry) => entry.role === role);
            return (
              <section key={role} className="signup-column">
                <h4>
                  {emoji} {label} <span className="muted">({inRole.length})</span>
                </h4>
                {inRole.length === 0 ? (
                  <p className="muted">—</p>
                ) : (
                  <ul className="signup-people">{inRole.map(row)}</ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        // A members event: everyone coming in one list.
        <section className="signup-column">
          <h4>
            ✅ Signed up <span className="muted">({available.length})</span>
          </h4>
          {available.length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <ul className="signup-people signup-people-wide">{available.map(row)}</ul>
          )}
        </section>
      )}
      {OTHER_STATUSES.map((status) => {
        const inStatus = event.entries.filter((entry) => entry.status === status).sort(bySignup);
        if (inStatus.length === 0) return null;
        return (
          <section key={status} className="signup-column">
            <h4>
              {STATUS_EMOJI[status]} {STATUS_LABELS[status]}{' '}
              <span className="muted">({inStatus.length})</span>
            </h4>
            <ul className="signup-people">{inStatus.map(row)}</ul>
          </section>
        );
      })}
    </>
  );
}
