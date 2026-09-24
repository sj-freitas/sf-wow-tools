import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPeople } from './api';
import { fuzzyScore } from './fuzzy';
import type { Person } from './types';

interface Props {
  guildId: string;
  /** Selected Discord user id, or '' when nothing is selected. */
  value: string;
  onChange: (discordUserId: string) => void;
}

const personLabel = (person: Person) =>
  person.displayName ?? person.username ?? person.discordUserId;

const looksLikeId = (text: string) => /^\d{15,25}$/.test(text.trim());

/**
 * Autocomplete for the Discord user of a new character. Matches (typo
 * tolerant) the person's Discord names, id and all their character names.
 * Someone not listed can still be added by pasting their Discord user id, as long as
 * they are in one of the guild's servers (the API checks).
 */
export function PlayerPicker({ guildId, value, onChange }: Props) {
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchPeople(guildId)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [guildId]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const matches = useMemo(() => {
    const scored = people.flatMap((person) => {
      const names = [person.username, person.displayName, ...person.characterNames].filter(
        (name): name is string => Boolean(name),
      );
      const idHit = person.discordUserId.startsWith(query.trim()) && query.trim().length > 0;
      const score = idHit ? 0 : fuzzyScore(query, names);
      return score === null ? [] : [{ person, score }];
    });
    return scored.sort((a, b) => a.score - b.score).slice(0, 8);
  }, [people, query]);

  const choose = (id: string, label: string) => {
    onChange(id);
    setQuery(label);
    setOpen(false);
  };

  const idOption =
    looksLikeId(query) && !people.some((person) => person.discordUserId === query.trim())
      ? query.trim()
      : null;

  return (
    <div className="dropdown" ref={root}>
      <input
        value={query}
        placeholder="Search name, character or Discord ID"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange('');
          setOpen(true);
        }}
        aria-autocomplete="list"
        aria-invalid={value === '' && query !== ''}
      />
      {open && (matches.length > 0 || idOption) && (
        <div className="dropdown-menu" role="listbox">
          {matches.map(({ person }) => (
            <button
              type="button"
              key={person.discordUserId}
              className="dropdown-item dropdown-option"
              onClick={() => choose(person.discordUserId, personLabel(person))}
            >
              <strong>{personLabel(person)}</strong>
              {person.username && person.displayName && (
                <span className="muted"> @{person.username}</span>
              )}
              <span className="muted"> · {person.discordUserId}</span>
              {person.characterNames.length > 0 && (
                <span className="muted option-sub">{person.characterNames.join(', ')}</span>
              )}
            </button>
          ))}
          {idOption && (
            <button
              type="button"
              className="dropdown-item dropdown-option"
              onClick={() => choose(idOption, idOption)}
            >
              Use Discord user ID <strong>{idOption}</strong>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
