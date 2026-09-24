import { useState, type FormEvent } from 'react';
import { createCharacter, updateCharacter } from './api';
import { MultiSelect } from './MultiSelect';
import { PlayerPicker } from './PlayerPicker';
import {
  ROLE_LABELS,
  WOW_CLASSES,
  requiresLastName,
  type Character,
  type Guild,
  type Role,
} from './types';

interface Props {
  guild: Guild;
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

export function CharacterForm({ guild, editing, onSaved, onCancel }: Props) {
  const initial = editing?.character;
  const lastNameRequired = requiresLastName(guild.gameVersion);
  // Also shown when editing a character that already has one, so saving can't silently drop it.
  const showLastName = lastNameRequired || Boolean(initial?.lastName);

  const [discordUserId, setDiscordUserId] = useState('');
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [characterClass, setCharacterClass] = useState<string>(initial?.class ?? WOW_CLASSES[0]);
  const [roles, setRoles] = useState<Role[]>(initial?.roles ?? ['TANK']);
  const [level, setLevel] = useState(initial ? String(initial.level) : '');
  const [isMain, setIsMain] = useState(initial?.isMain ?? false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!initial && guild.isOfficer && discordUserId === '') {
      setError('Pick a player from the list, or paste their Discord user ID.');
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
              <PlayerPicker guildId={guild.id} value={discordUserId} onChange={setDiscordUserId} />
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
        <label className="field">
          Class
          <select value={characterClass} onChange={(e) => setCharacterClass(e.target.value)}>
            {WOW_CLASSES.map((c) => (
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
