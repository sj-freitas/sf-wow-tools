import { useState, type FormEvent } from 'react';
import { createCharacter, updateCharacter } from './api';
import { MultiSelect } from './MultiSelect';
import { classNamesOf, gameOf, racesOf, requiresLastName, useGames } from './game';
import { PlayerPicker } from './PlayerPicker';
import { ROLE_LABELS, type Character, type Guild, type Role, type User } from './types';

interface Props {
  guild: Guild;
  /** The logged-in user: Officers add characters for themselves unless they pick someone else. */
  currentUser: User;
  /** When set the form edits this character instead of adding one. */
  editing?: { character: Character; playerLabel: string };
  onSaved: () => void;
  onCancel: () => void;
}

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

// Letters of any alphabet (combining marks allowed), no digits or punctuation; the API is the
// authority, this only gives early feedback.
const NAME_PATTERN = '\\p{L}[\\p{L}\\p{M}]*';
const NAME_HINT = 'Letters only (any alphabet), 2 to 12 letters.';

export function CharacterForm({ guild, currentUser, editing, onSaved, onCancel }: Props) {
  const initial = editing?.character;
  const games = useGames();
  const game = gameOf(games, guild.gameVersion);
  const lastNameRequired = requiresLastName(games, guild.gameVersion);
  // The races of the guild's faction, and which classes each can be. Race only narrows the classes
  // (it is not stored yet); without one, every class of the version is offered.
  const races = racesOf(game, guild.faction);
  const [race, setRace] = useState('');
  const allClasses = classNamesOf(game);
  const classOptions = race
    ? (races.find((r) => r.race === race)?.classes ?? allClasses)
    : allClasses;
  // Also shown when editing a character that already has one, so saving can't silently drop it.
  const showLastName = lastNameRequired || Boolean(initial?.lastName);

  const [discordUserId, setDiscordUserId] = useState(currentUser.discordId);
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [chosenClass, setCharacterClass] = useState<string>(initial?.class ?? '');
  // A class the race (or version) does not offer falls back to the first one that fits.
  const characterClass = classOptions.includes(chosenClass)
    ? chosenClass
    : (classOptions[0] ?? chosenClass);
  const [roles, setRoles] = useState<Role[]>(initial?.roles ?? ['TANK']);
  const [level, setLevel] = useState(initial ? String(initial.level) : '');
  const [isMain, setIsMain] = useState(initial?.isMain ?? false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!initial && guild.isOfficer && discordUserId === '') {
      setError('Pick a player from the search results, or paste their Discord user ID.');
      return;
    }
    const last = showLastName ? lastName.trim() : '';
    if (lastNameRequired && last === '') {
      setError(`Characters in ${guild.gameVersion} need a last name.`);
      return;
    }
    const fields = {
      // The API takes `Name` or `Name-Lastname`.
      name: last === '' ? firstName.trim() : `${firstName.trim()}-${last}`,
      class: characterClass,
      roles,
      isMain,
      level: level === '' ? undefined : Number(level),
    };
    (initial
      ? updateCharacter(initial.id, fields)
      : createCharacter(guild.id, { ...fields, discordUserId: discordUserId || undefined })
    )
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <form className="card-body" onSubmit={handleSubmit}>
      <div className="form-grid form-grid-3">
        {(editing || guild.isOfficer) && (
          <div className="field field-wide">
            Discord user
            {editing ? (
              <input value={editing.playerLabel} disabled />
            ) : (
              <PlayerPicker
                guildId={guild.id}
                value={discordUserId}
                onChange={setDiscordUserId}
                self={{ discordId: currentUser.discordId, label: currentUser.displayName }}
              />
            )}
          </div>
        )}
        <label className="field">
          {showLastName ? 'First name' : 'Name'}
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            pattern={NAME_PATTERN}
            minLength={2}
            maxLength={12}
            title={NAME_HINT}
            required
          />
        </label>
        {showLastName && (
          <label className="field">
            Last name
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              pattern={NAME_PATTERN}
              minLength={2}
              maxLength={12}
              title={NAME_HINT}
              required={lastNameRequired}
            />
          </label>
        )}
        {races.length > 0 && (
          <label className="field">
            Race
            <select value={race} onChange={(e) => setRace(e.target.value)}>
              <option value="">Any (show every class)</option>
              {races.map((r) => (
                <option key={r.race}>{r.race}</option>
              ))}
            </select>
            <small className="muted">Narrows the classes below to what the race can be.</small>
          </label>
        )}
        <label className="field">
          Class
          <select value={characterClass} onChange={(e) => setCharacterClass(e.target.value)}>
            {classOptions.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="field">
          Roles
          <MultiSelect
            options={ROLE_OPTIONS}
            value={roles}
            onChange={setRoles}
            placeholder="Select roles"
          />
        </div>
        <label className="field">
          Level (optional)
          <input
            type="number"
            min={1}
            max={100}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          />
        </label>
        <div className="field">
          Main character
          <label className="field-toggle">
            <input type="checkbox" checked={isMain} onChange={(e) => setIsMain(e.target.checked)} />
            This is a main
          </label>
        </div>
      </div>
      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={roles.length === 0}>
          {initial ? 'Save changes' : 'Add character'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
