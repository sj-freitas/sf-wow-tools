import { useState, type FormEvent } from 'react';
import { createCharacter, updateCharacter } from './api';
import { MultiSelect } from './MultiSelect';
import { PlayerPicker } from './PlayerPicker';
import { ROLE_LABELS, WOW_CLASSES, type Character, type Guild, type Role } from './types';

interface Props {
  guild: Guild;
  /** When set the form edits this character instead of adding one. */
  editing?: { character: Character; playerLabel: string };
  onSaved: () => void;
  onCancel: () => void;
}

const fullName = (character: Character) =>
  `${character.firstName}-${character.lastName}`.replace(/-$/, '');

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export function CharacterForm({ guild, editing, onSaved, onCancel }: Props) {
  const initial = editing?.character;
  const [discordUserId, setDiscordUserId] = useState('');
  const [name, setName] = useState(initial ? fullName(initial) : '');
  const [characterClass, setCharacterClass] = useState<string>(initial?.class ?? WOW_CLASSES[0]);
  const [roles, setRoles] = useState<Role[]>(initial?.roles ?? ['TANK']);
  const [level, setLevel] = useState(initial ? String(initial.level) : '');
  const [isMain, setIsMain] = useState(initial?.isMain ?? false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!initial && discordUserId === '') {
      setError('Pick a player from the list, or paste their Discord user ID.');
      return;
    }
    const fields = {
      name: name.trim(),
      class: characterClass,
      roles,
      isMain,
      level: level === '' ? undefined : Number(level),
    };
    (initial
      ? updateCharacter(initial.id, fields)
      : createCharacter(guild.id, { ...fields, discordUserId })
    )
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <form className="card-body" onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="field">
          Discord user
          {editing ? (
            <input value={editing.playerLabel} disabled />
          ) : (
            <PlayerPicker guildId={guild.id} value={discordUserId} onChange={setDiscordUserId} />
          )}
        </div>
        <label className="field">
          Character name
          <input
            placeholder="Name or Name-Lastname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
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
          <div className="checks">
            <label>
              <input
                type="checkbox"
                checked={isMain}
                onChange={(e) => setIsMain(e.target.checked)}
              />
              This is a main
            </label>
          </div>
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
