import { useState } from 'react';
import { Link } from 'react-router-dom';
import { characterPagePath } from '../guildPath';
import { BinIcon, PencilIcon } from '../Icons';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import { ROLE_CATEGORIES, STATUS_LABELS, entryName, errorText } from './labels';
import { StatusIcon } from './StatusIcon';
import { ClassMark } from '../ClassMark';
import { RoleMark } from '../RoleMark';
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

  const discordUrl = (entry: Entry) => `https://discord.com/users/${entry.discordUserId}`;

  // The Discord name, under a character's when it isn't the same.
  const discordShown = (entry: Entry) =>
    entry.characterName !== null && entry.discordName !== entry.characterName;

  /**
   * One person, as a card the same size in every list: the name across the top (cut short when
   * long, whole on hover) with Change and Remove as small icons in the corner; then the sign-up
   * number and the Discord name; then the note, its line kept even when there is none. The name
   * opens the character's page, or the person's Discord profile when there's no character; the
   * Discord name opens the profile.
   */
  const row = (entry: Entry) => (
    <li key={entry.id} className="signup-person signup-card">
      <span className="signup-card-top">
        {entry.status !== 'AVAILABLE' && entry.role && (
          <RoleMark gameVersion={guild.gameVersion} role={entry.role} />
        )}
        <ClassMark gameVersion={guild.gameVersion} className={entry.characterClass} />
        {entry.characterPath ? (
          <Link
            className="signup-card-name"
            to={characterPagePath(guild, entry.characterPath)}
            title={entryName(entry)}
          >
            {entryName(entry)}
          </Link>
        ) : (
          <a
            className="signup-card-name"
            href={discordUrl(entry)}
            target="_blank"
            rel="noreferrer"
            title={entryName(entry)}
          >
            {entryName(entry)}
          </a>
        )}
        {(officer || (isMine(entry) && !event.closed)) && (
          <span className="signup-card-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={`Change ${entryName(entry)}’s sign-up`}
              title="Change"
              onClick={() =>
                onEdit(isMine(entry) && !officer ? { kind: 'self' } : { kind: 'someone', entry })
              }
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              className="icon-button icon-button-danger"
              aria-label={`Remove ${entryName(entry)}’s sign-up`}
              title="Remove"
              onClick={() => remove(entry)}
            >
              <BinIcon />
            </button>
          </span>
        )}
      </span>
      <span className="signup-card-sub">
        <span className="signup-card-number" title="Sign-up number">
          #{numbers.get(entry.id)}
        </span>
        {discordShown(entry) && (
          <>
            {' · '}
            <a
              href={discordUrl(entry)}
              target="_blank"
              rel="noreferrer"
              title={`${entry.discordName} on Discord`}
            >
              {entry.discordName}
            </a>
          </>
        )}
      </span>
      <span className="signup-card-note" title={entry.note ?? undefined}>
        {entry.note ? `“${entry.note}”` : '\u00a0'}
      </span>
    </li>
  );
  const rows = (entries: Entry[]) => entries.map(row);

  return (
    <>
      {dialog}
      {error && <p className="status-error">{error}</p>}
      {event.layout.usesCharacters ? (
        <div className="signup-columns">
          {ROLE_CATEGORIES.map(({ role, label }) => {
            const inRole = available.filter((entry) => entry.role === role);
            return (
              <section key={role} className="signup-column">
                <h4>
                  <RoleMark gameVersion={guild.gameVersion} role={role} /> {label}{' '}
                  <span className="muted">({inRole.length})</span>
                </h4>
                {inRole.length === 0 ? (
                  <p className="muted">—</p>
                ) : (
                  <ul className="signup-people">{rows(inRole)}</ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        // A members event: everyone coming in one list.
        <section className="signup-column">
          <h4>
            <StatusIcon status="AVAILABLE" /> Signed up{' '}
            <span className="muted">({available.length})</span>
          </h4>
          {available.length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <ul className="signup-people signup-people-wide">{rows(available)}</ul>
          )}
        </section>
      )}
      {OTHER_STATUSES.map((status) => {
        const inStatus = event.entries.filter((entry) => entry.status === status).sort(bySignup);
        if (inStatus.length === 0) return null;
        return (
          <section key={status} className="signup-column">
            <h4>
              <StatusIcon status={status} /> {STATUS_LABELS[status]}{' '}
              <span className="muted">({inStatus.length})</span>
            </h4>
            {/* The same grid as the members list, so every answer's rows look alike. */}
            <ul className="signup-people signup-people-wide">{rows(inStatus)}</ul>
          </section>
        );
      })}
    </>
  );
}
