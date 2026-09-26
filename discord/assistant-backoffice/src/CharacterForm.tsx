import { useState, type FormEvent } from 'react';
import { createCharacter, updateCharacter } from './api';
import { MultiSelect } from './MultiSelect';
import { fetchArmoryCharacter } from './api';
import { CopyableName } from './CopyableName';
import { classNamesOf, gameOf, racesOf, requiresLastName, useArmory, useGames } from './game';
import { PlayerPicker } from './PlayerPicker';
import { ROLE_LABELS, type Character, type Guild, type Role, type User } from './types';

interface Props {
  guild: Guild;
  /** The logged-in user: Officers add characters for themselves unless they pick someone else. */
  currentUser: User;
  /** When set the form edits this character instead of adding one. */
  editing?: { character: Character; playerLabel: string; playerId: string };
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
  // The races of the guild's faction, and which classes each can be. Adding a character starts with
  // the race: the class is locked until one is chosen, and then offers what that race can be. Race
  // is not stored yet, so editing a character (whose race is unknown) offers every class.
  const races = racesOf(game, guild.faction);
  const [race, setRace] = useState('');
  const allClasses = classNamesOf(game);
  const classLocked = !initial && races.length > 0 && race === '';
  const classOptions = classLocked
    ? []
    : race
      ? (races.find((r) => r.race === race)?.classes ?? allClasses)
      : allClasses;
  // Also shown when editing a character that already has one, so saving can't silently drop it.
  const showLastName = lastNameRequired || Boolean(initial?.lastName);

  const [discordUserId, setDiscordUserId] = useState(currentUser.discordId);
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [characterClass, setCharacterClass] = useState<string>(initial?.class ?? '');

  /** Changing the race keeps the class only if the new race can be it; otherwise it is cleared. */
  const changeRace = (next: string) => {
    setRace(next);
    const allowed = next === '' ? allClasses : (races.find((r) => r.race === next)?.classes ?? []);
    setCharacterClass((current) => (allowed.includes(current) ? current : ''));
  };
  const [roles, setRoles] = useState<Role[]>(initial?.roles ?? ['TANK']);
  const [level, setLevel] = useState(initial ? String(initial.level) : '');
  const [isMain, setIsMain] = useState(initial?.isMain ?? false);
  const [error, setError] = useState<string | null>(null);

  // TEST: fill race, class and level from the armory (Officers), with the name typed above.
  const armory = useArmory();
  const [armoryBusy, setArmoryBusy] = useState(false);
  const [armoryNote, setArmoryNote] = useState<{ ok: boolean; text: string } | null>(null);
  const loadFromArmory = () => {
    setArmoryBusy(true);
    setArmoryNote(null);
    fetchArmoryCharacter(guild.id, firstName.trim())
      .then((found) => {
        const raceEntry = races.find((r) => r.race.toLowerCase() === found.race.toLowerCase());
        const className = allClasses.find((c) => c.toLowerCase() === found.class.toLowerCase());
        const problems: string[] = [];
        if (raceEntry) setRace(raceEntry.race);
        else if (races.length > 0)
          problems.push(`${found.race} is not a race of this guild's faction`);
        const classFits = className && (!raceEntry || raceEntry.classes.includes(className));
        setCharacterClass(classFits ? className : '');
        if (!className) problems.push(`${guild.gameVersion} has no ${found.class} class`);
        else if (!classFits)
          problems.push(`${found.race} cannot be a ${found.class} in ${guild.gameVersion}`);
        setLevel(String(Math.min(100, Math.max(1, found.level))));
        const summary = `${found.name}: ${found.race} ${found.class}, level ${found.level}.`;
        setArmoryNote(
          problems.length === 0
            ? { ok: true, text: `Loaded ${summary}` }
            : { ok: false, text: `Loaded ${summary} Not filled in: ${problems.join('; ')}.` },
        );
      })
      .catch((err: unknown) =>
        setArmoryNote({
          ok: false,
          text: `${err instanceof Error ? err.message : String(err)} Fill the character in by hand.`,
        }),
      )
      .finally(() => setArmoryBusy(false));
  };

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
              <div className="picked-player">
                <CopyableName label={editing.playerLabel} id={editing.playerId} />
              </div>
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
        {!armory && guild.isOfficer && (
          <div className="field field-wide armory-load">
            <small className="muted">
              “Load from armory” (TEST) is off: the server has no Battle.net client. Set
              BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET, restart it and reload this page.
            </small>
          </div>
        )}
        {armory && guild.isOfficer && (
          <div className="field field-wide armory-load">
            <span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={armoryBusy || firstName.trim().length < 2}
                title="Fills race, class and level from the armory, using the name typed below"
                onClick={loadFromArmory}
              >
                {armoryBusy ? 'Loading…' : 'Load from armory'}
              </button>{' '}
              <span className="badge badge-live">TEST</span>{' '}
              <span className="muted">
                {armory.description}. Type the name first; nothing else is needed.
              </span>
            </span>
            {armoryNote && (
              <span className={armoryNote.ok ? 'run-ok' : 'status-error'} role="status">
                {armoryNote.text}
              </span>
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
            <select value={race} onChange={(e) => changeRace(e.target.value)} required={!initial}>
              <option value="" disabled={!initial}>
                {initial ? 'Any (show every class)' : 'Choose a race…'}
              </option>
              {races.map((r) => (
                <option key={r.race}>{r.race}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Class
          <select
            value={characterClass}
            onChange={(e) => setCharacterClass(e.target.value)}
            disabled={classLocked}
            required
            title={classLocked ? 'Choose a race first' : undefined}
          >
            <option value="" disabled>
              {classLocked ? 'Choose a race first' : 'Choose a class…'}
            </option>
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
