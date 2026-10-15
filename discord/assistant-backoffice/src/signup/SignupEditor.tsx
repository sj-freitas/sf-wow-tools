import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { guildPath } from '../guildPath';
import { InlineSpinner } from '../Loading';
import type { Guild, Role } from '../types';
import {
  ROLE_CATEGORIES,
  ROLE_EMOJI,
  ROLE_NAME,
  STATUS_EMOJI,
  STATUS_LABELS,
  errorText,
} from './labels';
import type { CharacterOption, Entry, SignupInput, SignupStatus } from './signupApi';

/** A character with no roles set could play any of them. */
const plays = (character: CharacterOption, role: Role): boolean =>
  character.roles.length === 0 || character.roles.includes(role);

const STATUSES: SignupStatus[] = ['AVAILABLE', 'LATE', 'TENTATIVE', 'ABSENT'];
const MAX_NOTE = 200;

interface Props {
  guild: Guild;
  characters: CharacterOption[];
  /** Their current sign-up, if any. */
  entry: Entry | null;
  /** Someone else's sign-up (an organiser editing it): wording changes, no "add character" link. */
  forSomeone?: string;
  /** False for a members event: people sign up as themselves, no character or role. */
  usesCharacters?: boolean;
  onSave: (input: SignupInput) => Promise<void>;
  onWithdraw?: () => Promise<void>;
  onCancel?: () => void;
}

/**
 * Status, character, role (of those the character plays) and note; on a members event only status
 * and note. The only
 * link to the roster is for someone with no characters at all; sign-ups are not where characters
 * are managed.
 */
export function SignupEditor({
  guild,
  characters,
  entry,
  forSomeone,
  usesCharacters = true,
  onSave,
  onWithdraw,
  onCancel,
}: Props) {
  // Character first, then one of the roles it plays (any role when it has none set).
  const rolesOf = (id: string): Role[] => {
    const found = characters.find((c) => c.id === id);
    return ROLE_CATEGORIES.map((category) => category.role).filter(
      (value) => !found || plays(found, value),
    );
  };
  const initialCharacter =
    (entry?.characterId && characters.some((c) => c.id === entry.characterId)
      ? entry.characterId
      : null) ??
    characters.find((c) => c.isMain)?.id ??
    characters[0]?.id ??
    '';
  const [status, setStatus] = useState<SignupStatus>(entry?.status ?? 'AVAILABLE');
  const [characterId, setCharacterId] = useState(initialCharacter);
  const [role, setRole] = useState<Role | ''>(() => {
    const roles = rolesOf(initialCharacter);
    return entry?.role && roles.includes(entry.role) ? entry.role : (roles[0] ?? '');
  });
  const [note, setNote] = useState(entry?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const character = characters.find((c) => c.id === characterId);
  const roles = rolesOf(characterId);
  const pickCharacter = (id: string) => {
    setCharacterId(id);
    // Keep the role when the new character plays it too.
    const playable = rolesOf(id);
    if (role === '' || !playable.includes(role)) setRole(playable[0] ?? '');
  };

  const needsCharacter = usesCharacters && status !== 'ABSENT';
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    action()
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run(() =>
      onSave({
        status,
        ...(usesCharacters && characterId && (needsCharacter || entry?.characterId)
          ? { characterId, role: role || undefined }
          : {}),
        ...(status === 'LATE' || status === 'TENTATIVE' ? { note } : {}),
      }),
    );
  };

  return (
    <form className="signup-editor" onSubmit={submit}>
      <div className="signup-status-picker" role="radiogroup" aria-label="Status">
        {STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={status === value}
            className={status === value ? 'signup-status signup-status-active' : 'signup-status'}
            onClick={() => setStatus(value)}
          >
            {STATUS_EMOJI[value]} {STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {usesCharacters &&
        (characters.length === 0 ? (
          needsCharacter && (
            <p className="muted">
              {forSomeone
                ? `${forSomeone} has no characters on ${guild.realm} for this faction.`
                : `You have no characters on ${guild.realm} for this faction yet.`}{' '}
              {!forSomeone && <Link to={guildPath(guild, 'roster/create')}>Add a character</Link>}
            </p>
          )
        ) : (
          <div className="form-grid">
            <label className="field">
              Character
              <select value={characterId} onChange={(e) => pickCharacter(e.target.value)}>
                {characters.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {option.class}
                    {option.isMain ? ' · Main' : ''}
                    {option.inGuild ? '' : ' · not in the guild yet'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {roles.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_EMOJI[value]} {ROLE_NAME[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      {(status === 'LATE' || status === 'TENTATIVE') && (
        <label className="field">
          Note for the organisers (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE}
            placeholder={
              status === 'LATE' ? 'e.g. I’ll be 30 minutes late' : 'e.g. Depends on work'
            }
          />
        </label>
      )}

      {character && !character.inGuild && needsCharacter && (
        <p className="muted">Signing up with {character.name} adds it to the guild’s roster.</p>
      )}
      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || (needsCharacter && !characterId)}
        >
          {busy ? <InlineSpinner label="Saving…" /> : entry ? 'Save' : 'Sign up'}
        </button>
        {onWithdraw && entry && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => run(onWithdraw)}
          >
            {forSomeone ? 'Remove sign-up' : 'Take back my sign-up'}
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
