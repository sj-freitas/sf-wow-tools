import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPeople } from './api';
import { DiscordName } from './DiscordName';
import { fuzzyScore } from './fuzzy';
import type { People, Person } from './types';

interface Props {
  guildId: string;
  /** Selected Discord user id, or '' when nothing is selected. */
  value: string;
  onChange: (discordUserId: string) => void;
  /** The logged-in user: marked "(you)", and who is selected when there is nothing else. */
  self: { discordId: string; label: string };
  /** Who is selected at first when it is not the logged-in user (an existing character's owner). */
  initial?: { discordId: string; label: string };
  /** The guild's people, when the page already has them (one picker per row): not fetched again. */
  people?: People;
  /**
   * In a table row: a shorter placeholder, and no hints in the overlay (the page explains them
   * once). Either way nothing shows under the search box: it never changes height.
   */
  compact?: boolean;
  /** A word after the selected name, its explanation on hover (a guessed player: "guess"). */
  pickedNote?: { text: string; title: string };
}

const NO_PEOPLE: People = { source: 'servers', people: [] };

const personLabel = (person: Person) =>
  person.displayName ?? person.username ?? person.discordUserId;

const looksLikeId = (text: string) => /^\d{15,25}$/.test(text.trim());

/**
 * Autocomplete for the Discord user of a new character. Matches (typo
 * tolerant) the person's Discord names, id and all their character names.
 * Someone not listed can still be added by pasting their Discord user id, as long as
 * they are in one of the guild's servers (the API checks).
 */
export function PlayerPicker({
  guildId,
  value,
  onChange,
  self,
  initial,
  people: given,
  compact = false,
  pickedNote,
}: Props) {
  const [loaded, setLoaded] = useState<People | null>(null);
  const { people, source } = given ?? loaded ?? NO_PEOPLE;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // Who is selected, by name: the user themselves at first, later whoever was picked.
  const [pickedLabel, setPickedLabel] = useState(initial?.label ?? self.label);
  const root = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (given) return;
    fetchPeople(guildId)
      .then(setLoaded)
      .catch(() => setLoaded(NO_PEOPLE));
  }, [guildId, given]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const searching = query.trim() !== '';
  const matches = useMemo(() => {
    // Nothing is listed until the user types: an empty box would just offer arbitrary names.
    if (!searching) return [];
    const scored = people.flatMap((person) => {
      const names = [person.username, person.displayName, ...person.characterNames].filter(
        (name): name is string => Boolean(name),
      );
      const idHit = person.discordUserId.startsWith(query.trim()) && query.trim().length > 0;
      const score = idHit ? 0 : fuzzyScore(query, names);
      return score === null ? [] : [{ person, score }];
    });
    return scored.sort((a, b) => a.score - b.score).slice(0, 8);
  }, [people, query, searching]);

  const choose = (id: string, label: string) => {
    onChange(id);
    setPickedLabel(label);
    setQuery('');
    setOpen(false);
  };

  const change = () => {
    onChange('');
    setQuery('');
    setOpen(false);
    // The search box only exists once nothing is selected.
    setTimeout(() => searchBox.current?.focus(), 0);
  };

  const idOption =
    looksLikeId(query) && !people.some((person) => person.discordUserId === query.trim())
      ? query.trim()
      : null;

  const results = [
    ...matches.map(({ person }) => ({ id: person.discordUserId, label: personLabel(person) })),
    ...(idOption ? [{ id: idOption, label: idOption }] : []),
  ];
  const onlyResult = query.trim() !== '' && results.length === 1 ? results[0] : null;
  // Only the players we know can be found (the page says so once when there is one picker per row).
  const knownOnly =
    source === 'known' && !compact ? (
      <div className="dropdown-hint muted">
        Showing only players we already know: Discord did not allow listing the servers' members.
        Enable the bot's <strong>Server Members Intent</strong> in the Discord Developer Portal (Bot
        → Privileged Gateway Intents) to search everyone.
      </div>
    ) : null;

  if (value !== '') {
    return (
      <div className="picked-player">
        <span>
          <DiscordName label={value === self.discordId ? self.label : pickedLabel} id={value} />
          {value === self.discordId && <span className="muted"> (you)</span>}
          {pickedNote && (
            <span className="muted picked-note" title={pickedNote.title}>
              {' '}
              ({pickedNote.text})
            </span>
          )}
        </span>
        <button type="button" className="btn btn-sm" onClick={change}>
          Change player
        </button>
      </div>
    );
  }

  return (
    <div className="dropdown" ref={root}>
      <div className="search-field">
        <span className="search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          ref={searchBox}
          type="search"
          value={query}
          placeholder={
            compact ? 'Search a Discord user…' : 'Search a player by Discord name, character or ID…'
          }
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            // Tab accepts the single suggestion; focus still moves on to the next field as usual.
            if (event.key === 'Tab' && !event.shiftKey && onlyResult) {
              choose(onlyResult.id, onlyResult.label);
            } else if (event.key === 'Tab' || event.key === 'Escape') {
              setOpen(false);
            }
          }}
          aria-autocomplete="list"
          aria-invalid={query !== ''}
        />
      </div>
      {/* Nothing under the box: what it has to say opens over the page, with the results, so the
          box and the picked player are the same height and typing moves nothing. */}
      {open && !searching && !compact && (
        <div className="dropdown-menu" role="status">
          <div className="dropdown-hint muted">
            Nobody is selected. Type to search the guild's players, then pick one from the results.
          </div>
          {knownOnly}
        </div>
      )}
      {open && (matches.length > 0 || idOption) && (
        <div className="dropdown-menu" role="listbox">
          <div className="dropdown-hint muted">Search results: click one to select</div>
          {matches.map(({ person }) => (
            <button
              type="button"
              key={person.discordUserId}
              className="dropdown-item dropdown-option"
              onClick={() => choose(person.discordUserId, personLabel(person))}
            >
              <strong>{personLabel(person)}</strong>
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
          {onlyResult && <div className="dropdown-hint muted">Press Tab to select</div>}
          {knownOnly}
        </div>
      )}
      {/* Over the rows below, like the results, rather than under the box. */}
      {open && searching && matches.length === 0 && !idOption && (
        <div className="dropdown-menu" role="status">
          <div className="dropdown-hint muted">No player matches “{query.trim()}”.</div>
          {knownOnly}
        </div>
      )}
    </div>
  );
}
