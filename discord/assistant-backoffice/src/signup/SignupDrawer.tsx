import { useEffect, useState, type ReactNode } from 'react';
import { Drawer } from '../Drawer';
import { Spinner } from '../Loading';
import type { Guild } from '../types';
import { entryName, errorText } from './labels';
import {
  fetchCharacterOptions,
  fetchMissing,
  removeEntry,
  saveMySignup,
  saveSomeonesSignup,
  withdrawMySignup,
  type CharacterOption,
  type Entry,
  type MissingPerson,
  type SignupEvent,
} from './signupApi';
import { SignupEditor } from './SignupEditor';

/**
 * Whose sign-up the drawer is for: your own, someone's existing one, someone picked already
 * (`person`), or — neither — someone to pick first from the people who haven't answered.
 */
export type DrawerTarget =
  | { kind: 'self' }
  | { kind: 'someone'; entry: Entry | null; person?: { discordUserId: string; name: string } };

/** The panel sliding in from the side for signing up, or changing a sign-up. */
export function SignupDrawer({
  guild,
  event,
  target,
  onClose,
  onSaved,
}: {
  guild: Guild;
  event: SignupEvent;
  target: DrawerTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<{ discordUserId: string; name: string } | null>(
    target.kind === 'someone' ? (target.person ?? null) : null,
  );
  const done = () => {
    onSaved();
    onClose();
  };

  let title: string;
  let body: ReactNode;
  if (target.kind === 'self') {
    title = event.mine ? 'Your sign-up' : 'Sign up';
    body = (
      <SignupEditor
        guild={guild}
        characters={event.myCharacters}
        usesCharacters={event.layout.usesCharacters}
        entry={event.mine}
        onSave={(input) => saveMySignup(guild.id, event.id, input).then(done)}
        onWithdraw={() => withdrawMySignup(guild.id, event.id).then(done)}
        onCancel={onClose}
      />
    );
  } else if (target.entry || picked) {
    const entry = target.entry;
    const person = entry
      ? { discordUserId: entry.discordUserId, name: entryName(entry) }
      : (picked as { discordUserId: string; name: string });
    title = entry ? `Change ${person.name}’s sign-up` : `Sign up ${person.name}`;
    body = (
      <SomeonesCharacters
        guild={guild}
        event={event}
        entry={entry}
        person={person}
        onDone={done}
        onCancel={onClose}
      />
    );
  } else {
    title = 'Sign up a player';
    body = <PersonPicker guild={guild} event={event} onPick={setPicked} />;
  }

  return (
    <Drawer title={title} onClose={onClose}>
      {body}
    </Drawer>
  );
}

/** Someone else's characters, then the same form (owner and Officers; works when closed too). */
function SomeonesCharacters({
  guild,
  event,
  entry,
  person,
  onDone,
  onCancel,
}: {
  guild: Guild;
  event: SignupEvent;
  entry: Entry | null;
  person: { discordUserId: string; name: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const usesCharacters = event.layout.usesCharacters;
  // A members event has no characters to load.
  const [characters, setCharacters] = useState<CharacterOption[] | null>(
    usesCharacters ? null : [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!usesCharacters) return;
    fetchCharacterOptions(guild.id, event.id, person.discordUserId)
      .then(setCharacters)
      .catch((err: unknown) => setError(errorText(err)));
  }, [guild.id, event.id, person.discordUserId, usesCharacters]);

  if (error) return <p className="status-error">{error}</p>;
  if (!characters) return <Spinner />;
  return (
    <SignupEditor
      guild={guild}
      characters={characters}
      usesCharacters={usesCharacters}
      entry={entry}
      forSomeone={person.name}
      onSave={(input) =>
        saveSomeonesSignup(guild.id, event.id, person.discordUserId, {
          ...input,
          name: entry ? undefined : person.name,
        }).then(onDone)
      }
      onWithdraw={entry ? () => removeEntry(guild.id, event.id, entry.id).then(onDone) : undefined}
      onCancel={onCancel}
    />
  );
}

/** The people who haven't answered yet, searchable, to pick who to sign up. */
function PersonPicker({
  guild,
  event,
  onPick,
}: {
  guild: Guild;
  event: SignupEvent;
  onPick: (person: { discordUserId: string; name: string }) => void;
}) {
  const [people, setPeople] = useState<MissingPerson[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMissing(guild.id, event.id)
      .then((missing) => setPeople(missing.people))
      .catch((err: unknown) => setError(errorText(err)));
  }, [guild.id, event.id]);

  const needle = query.trim().toLowerCase();
  const shown = (people ?? []).filter(
    (person) =>
      needle === '' || `${person.name} ${person.mains.join(' ')}`.toLowerCase().includes(needle),
  );
  return (
    <div className="signup-editor">
      <input
        className="drawer-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people who haven’t answered"
        aria-label="Search people"
      />
      {error ? (
        <p className="status-error">{error}</p>
      ) : people === null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <p className="muted">Nobody found.</p>
      ) : (
        <ul className="signup-people">
          {shown.slice(0, 50).map((person) => (
            <li key={person.discordUserId}>
              <button
                type="button"
                className="signup-person signup-pick"
                onClick={() => onPick({ discordUserId: person.discordUserId, name: person.name })}
              >
                <span>
                  <strong>{person.name}</strong>
                  <span className="muted">
                    {' · '}
                    {person.mains.length > 0 ? `Main: ${person.mains.join(', ')}` : 'No main'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
