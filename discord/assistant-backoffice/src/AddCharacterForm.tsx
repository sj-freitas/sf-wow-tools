import { useState, type FormEvent } from 'react';
import { createCharacter } from './api';
import { ROLE_LABELS, WOW_CLASSES, type Guild, type Role } from './types';

interface Props {
  guild: Guild;
  onAdded: () => void;
  onCancel: () => void;
}

export function AddCharacterForm({ guild, onAdded, onCancel }: Props) {
  const [discordUserId, setDiscordUserId] = useState('');
  const [name, setName] = useState('');
  const [characterClass, setCharacterClass] = useState<string>(WOW_CLASSES[0]);
  const [roles, setRoles] = useState<Role[]>(['TANK']);
  const [level, setLevel] = useState('');
  const [isMain, setIsMain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRole = (role: Role) =>
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createCharacter(guild.id, {
      discordUserId: discordUserId.trim(),
      name: name.trim(),
      class: characterClass,
      roles,
      isMain,
      level: level === '' ? undefined : Number(level),
    })
      .then(onAdded)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <form className="card-body" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field">
          Discord user ID
          <input
            value={discordUserId}
            onChange={(e) => setDiscordUserId(e.target.value)}
            inputMode="numeric"
            required
          />
        </label>
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
          Roles
          <div className="checks">
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={() => toggleRole(role)}
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        </div>
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
          Add character
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
