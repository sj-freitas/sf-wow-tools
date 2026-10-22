import { useEffect, useState, type FormEvent } from 'react';
import {
  createCharacter,
  fetchAttributes,
  fetchMigratableCharacters,
  migrateCharacter,
  setCharacterAttributes,
  updateCharacter,
} from './api';
import { AttributeChip } from './AttributeChip';
import { MultiSelect } from './MultiSelect';
import { fetchArmoryCharacter } from './api';
import { DiscordName } from './DiscordName';
import {
  classNamesOf,
  gameOf,
  racesOf,
  requiresLastName,
  rolesOfClass,
  useArmory,
  useGames,
} from './game';
import { PlayerPicker } from './PlayerPicker';
import {
  ROLE_LABELS,
  type ArmorySpec,
  type Character,
  type Guild,
  type GuildAttribute,
  type Role,
  type User,
} from './types';
import { Select } from './Select';

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
  // the race: the class is locked until one is chosen, and then offers what that race can be.
  const races = racesOf(game, guild.faction);
  const [race, setRace] = useState(initial?.race ?? '');
  const allClasses = classNamesOf(game);
  // New characters must have a race before a class; editing one whose race is unknown (added
  // before this was collected, or from Discord) still offers every class, unlocked.
  const classLocked = !initial && races.length > 0 && race === '';
  const classOptions = classLocked
    ? []
    : race
      ? (races.find((r) => r.race === race)?.classes ?? allClasses)
      : allClasses;
  // Only versions that say so have last names; for the others the field is not there.
  const showLastName = lastNameRequired;

  // Who plays it: the logged-in user for a new character, the current owner when editing.
  const [discordUserId, setDiscordUserId] = useState(editing?.playerId ?? currentUser.discordId);
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [characterClass, setCharacterClass] = useState<string>(initial?.class ?? '');
  const [roles, setRoles] = useState<Role[]>(initial?.roles ?? []);

  // Roles depend on the class the way the class depends on the race: locked until a class is
  // chosen, then only what the class can play (every role when the version does not say).
  const roleOptionsFor = (className: string) => {
    const allowed = rolesOfClass(game, className);
    return allowed.length > 0
      ? ROLE_OPTIONS.filter((option) => allowed.includes(option.value))
      : ROLE_OPTIONS;
  };
  const roleLocked = characterClass === '';
  const roleOptions = roleLocked ? [] : roleOptionsFor(characterClass);

  /**
   * Changing the class keeps the roles the new class can play and drops the others. A class that
   * plays only one role gets it selected: there is nothing else to choose.
   */
  const applyClass = (next: string) => {
    setCharacterClass(next);
    const options = next === '' ? [] : roleOptionsFor(next);
    setRoles((current) =>
      options.length === 1
        ? [options[0].value]
        : current.filter((role) => options.some((option) => option.value === role)),
    );
  };

  /** Changing the race keeps the class only if the new race can be it; otherwise it is cleared. */
  const changeRace = (next: string) => {
    setRace(next);
    const allowed = next === '' ? allClasses : (races.find((r) => r.race === next)?.classes ?? []);
    applyClass(allowed.includes(characterClass) ? characterClass : '');
  };
  const [level, setLevel] = useState(initial ? String(initial.level) : '');
  // Editing: the guild's attributes and which this character has. Officers set them (a guild says
  // with them what a main, a switcher… is); everyone else sees them.
  const [attributes, setAttributes] = useState<GuildAttribute[]>([]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    fetchAttributes(guild.id)
      .then((all) => {
        setAttributes(all);
        setPicked(new Set(all.filter((a) => a.characterIds.includes(initialId)).map((a) => a.id)));
      })
      .catch(() => setAttributes([]));
  }, [guild.id, initialId]);
  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [error, setError] = useState<string | null>(null);

  // Adding a character: the chosen player's characters already on this server and faction, not in
  // this guild yet — "migrate" one instead of creating a duplicate of the same character.
  const [migratable, setMigratable] = useState<Character[]>([]);
  const [toMigrate, setToMigrate] = useState('');
  const [migrating, setMigrating] = useState(false);
  useEffect(() => {
    if (initial || discordUserId === '') {
      setMigratable([]);
      return;
    }
    let current = true;
    fetchMigratableCharacters(guild.id, discordUserId)
      .then((found) => {
        if (!current) return;
        setMigratable(found);
        setToMigrate(found[0]?.id ?? '');
      })
      .catch(() => current && setMigratable([]));
    return () => {
      current = false;
    };
  }, [guild.id, discordUserId, initial]);

  const runMigrate = () => {
    if (toMigrate === '') return;
    setError(null);
    setMigrating(true);
    migrateCharacter(guild.id, toMigrate)
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setMigrating(false));
  };

  // Fill race, class and level from the armory (Officers), with the name typed above (a test
  // armory for now: see useArmory).
  const armory = useArmory();
  const nameTyped = firstName.trim().length >= 2 && (!showLastName || lastName.trim().length >= 2);
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
        applyClass(classFits ? className : '');
        if (!className) problems.push(`${guild.gameVersion} has no ${found.class} class`);
        else if (!classFits)
          problems.push(`${found.race} cannot be a ${found.class} in ${guild.gameVersion}`);
        setLevel(String(Math.min(100, Math.max(1, found.level))));
        // EXPERIMENTAL: the roles of its specs, worked out from its talents (those the class can
        // play here; the class's first spec when the talents didn't tell).
        const playable = classFits ? roleOptionsFor(className).map((option) => option.value) : [];
        const roles = found.specs.roles.filter((role) => playable.includes(role));
        if (roles.length > 0) setRoles(roles);
        const specText = (spec: ArmorySpec) =>
          `${spec.spec} (${ROLE_LABELS[spec.role]}${spec.guessed ? ', assumed' : `, ${spec.points} points`})`;
        const specsText = found.specs.main
          ? ` Specs (experimental): ${specText(found.specs.main)}${found.specs.secondary ? `, then ${specText(found.specs.secondary)}` : ''}.`
          : '';
        const summary = `${found.name}: ${found.race} ${found.class}, level ${found.level}.${specsText}`;
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
    if (guild.isOfficer && discordUserId === '') {
      setError('Pick a player from the search results, or paste their Discord user ID.');
      return;
    }
    // A character that already has a last name keeps it when its version no longer shows the field.
    const last = showLastName ? lastName.trim() : (initial?.lastName ?? '');
    if (lastNameRequired && last === '') {
      setError(`Characters in ${guild.gameVersion} need a last name.`);
      return;
    }
    const fields = {
      // The API takes `Name` or `Name-Lastname`.
      name: last === '' ? firstName.trim() : `${firstName.trim()}-${last}`,
      class: characterClass,
      race,
      roles,
      level: level === '' ? undefined : Number(level),
    };
    // Only an Officer who picked someone else moves the character.
    const moved =
      editing && guild.isOfficer && discordUserId !== editing.playerId ? discordUserId : undefined;
    (initial
      ? updateCharacter(guild.id, initial.id, {
          ...fields,
          ...(moved ? { discordUserId: moved } : {}),
        }).then(() =>
          // Officers: its attributes too.
          guild.isOfficer && picked
            ? setCharacterAttributes(guild.id, initial.id, [...picked])
            : undefined,
        )
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
            {editing && !guild.isOfficer ? (
              <div className="picked-player">
                <DiscordName label={editing.playerLabel} id={editing.playerId} />
              </div>
            ) : (
              <PlayerPicker
                guildId={guild.id}
                value={discordUserId}
                onChange={setDiscordUserId}
                self={{ discordId: currentUser.discordId, label: currentUser.displayName }}
                initial={
                  editing ? { discordId: editing.playerId, label: editing.playerLabel } : undefined
                }
              />
            )}
          </div>
        )}
        {!initial && migratable.length > 0 && (
          <div className="field field-wide migrate-list">
            <span>
              Already on this server: migrate an existing character instead of creating a new one
            </span>
            <div className="migrate-row">
              <Select value={toMigrate} onChange={(v) => setToMigrate(v)}>
                {migratable.map((character) => (
                  <option key={character.id} value={character.id}>
                    {`${character.firstName} ${character.lastName}`.trim()} — {character.class}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={migrating || toMigrate === ''}
                onClick={runMigrate}
              >
                {migrating ? 'Migrating…' : 'Migrate'}
              </button>
            </div>
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
        {armory && guild.isOfficer && (
          // Under the name it reads: unlocked once the name is typed (both parts when the version
          // has last names; the lookup itself only uses the first name for now).
          <div className="field field-wide armory-load">
            <span>
              <button
                type="button"
                className="btn"
                disabled={armoryBusy || !nameTyped}
                title="Fills race, class and level from the armory, using the name above"
                onClick={loadFromArmory}
              >
                {armoryBusy ? 'Loading…' : 'Load from armory'}
              </button>
            </span>
            {armoryNote && (
              <span className={armoryNote.ok ? 'run-ok' : 'status-error'} role="status">
                {armoryNote.text}
              </span>
            )}
          </div>
        )}
        {races.length > 0 && (
          <label className="field">
            Race
            <Select value={race} onChange={(v) => changeRace(v)} required={!initial}>
              <option value="" disabled={!initial}>
                {initial ? 'Unknown (show every class)' : 'Choose a race…'}
              </option>
              {races.map((r) => (
                <option key={r.race}>{r.race}</option>
              ))}
            </Select>
          </label>
        )}
        <label className="field">
          Class
          <Select
            value={characterClass}
            onChange={(v) => applyClass(v)}
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
          </Select>
        </label>
        <div className="field">
          Roles
          <MultiSelect
            options={roleOptions}
            value={roles}
            onChange={setRoles}
            placeholder={roleLocked ? 'Choose a class first' : 'Select roles'}
            disabled={roleLocked}
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
      </div>
      {initial && attributes.length > 0 && picked && (
        <div className="field">
          Attributes
          {guild.isOfficer ? (
            <div className="roster-attribute-filter" role="group" aria-label="Attributes">
              {attributes.map((attribute) => (
                <button
                  key={attribute.id}
                  type="button"
                  aria-pressed={picked.has(attribute.id)}
                  className={
                    picked.has(attribute.id)
                      ? 'attribute-toggle attribute-toggle-on'
                      : 'attribute-toggle'
                  }
                  onClick={() => togglePicked(attribute.id)}
                >
                  <AttributeChip name={attribute.name} color={attribute.color} />
                </button>
              ))}
            </div>
          ) : picked.size > 0 ? (
            <div className="attribute-chips">
              {attributes
                .filter((attribute) => picked.has(attribute.id))
                .map((attribute) => (
                  <AttributeChip key={attribute.id} name={attribute.name} color={attribute.color} />
                ))}
            </div>
          ) : (
            <span className="muted">None. Officers set them.</span>
          )}
        </div>
      )}
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
