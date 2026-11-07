import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createCharacter,
  fetchArmoryCharacter,
  fetchArmoryGuild,
  fetchPeople,
  migrateCharacter,
  updateCharacter,
} from './api';
import { ClassMark } from './ClassMark';
import { DiscordName } from './DiscordName';
import { armoryLinkFor, firstRoleOfClass, gameOf, useGames } from './game';
import { guildPath } from './guildPath';
import { InlineSpinner, Spinner } from './Loading';
import { OneLine } from './OneLine';
import { PlayerPicker } from './PlayerPicker';
import { showToast } from './toast';
import type {
  ArmoryGuildMember,
  ArmoryGuildRoster,
  Guild,
  People,
  Person,
  Role,
  User,
} from './types';
import { useCurrentUrl, useReturnTo } from './useReturnTo';

interface Props {
  guild: Guild;
  currentUser: User;
}

type RowState = { status: 'busy' } | { status: 'error'; message: string };

/**
 * What a row's button does: add it for the player picked, add it unclaimed (no one picked), add a
 * character we already know (another guild's) as it is, or give an unclaimed one on the roster the
 * player picked.
 */
type Action = 'add' | 'add-unclaimed' | 'migrate' | 'assign';

const keyOf = (member: { name: string; lastName: string }): string =>
  `${member.name} ${member.lastName}`.toLocaleLowerCase();

const fullName = (member: { name: string; lastName: string }): string =>
  `${member.name} ${member.lastName}`.trim();

const personLabel = (person: {
  displayName: string | null;
  username: string | null;
  discordUserId: string;
}) => person.displayName ?? person.username ?? person.discordUserId;

const rankLabel = (rank: number): string => (rank === 0 ? 'Guild Master' : `Rank ${rank}`);

/** Letters only, no accents, lower case: "Holybliss ✨" and "holybliss" are the same. */
const simplify = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '');

/**
 * Who probably plays a character: the one guild member whose Discord name is its name, last name
 * or full name, or starts with its name for a name of 4 letters or more. Nobody when none or
 * several are.
 */
function suggestPlayer(member: ArmoryGuildMember, people: Person[]): Person | null {
  const first = simplify(member.name);
  const last = simplify(member.lastName);
  const full = first + last;
  if (first.length < 2) return null;
  const matches = people.filter((person) =>
    [person.username, person.displayName].some((name) => {
      const simple = name ? simplify(name) : '';
      return (
        simple === first ||
        simple === full ||
        (last.length >= 2 && simple === last) ||
        (first.length >= 4 && simple.startsWith(first))
      );
    }),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** On the roster with no player yet (added unclaimed). */
const unclaimedOnRoster = (member: ArmoryGuildMember): boolean =>
  Boolean(member.character?.inGuild && !member.character.player);

/**
 * `/roster/armory` (Officers): the guild's members in its version's armory, next to the roster.
 * Those not on it are added for the Discord user an Officer picks (a guess is filled in when one
 * member's Discord name is the character's name, last name or full name), or unclaimed when no
 * one is: race, class and level from the armory, roles from its talents (the class's first spec
 * without any), through the same endpoint as "Add character". An unclaimed one on the roster can
 * be given its player here too. A character we already have on the guild's server (another
 * guild's) is added as it is, for its own player.
 */
export function ArmoryImportPage({ guild, currentUser }: Props) {
  const game = gameOf(useGames(), guild.gameVersion);
  const back = useReturnTo(guildPath(guild, 'roster'));
  const here = useCurrentUrl();
  const [nameInput, setNameInput] = useState(guild.name);
  const [guildName, setGuildName] = useState(guild.name);
  const [roster, setRoster] = useState<ArmoryGuildRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  // The Discord user picked per character (by `keyOf`); '' once a suggestion is cleared.
  const [picks, setPicks] = useState<Map<string, string>>(new Map());
  const [states, setStates] = useState<Map<string, RowState>>(new Map());
  const [show, setShow] = useState<'missing' | 'unclaimed' | 'all'>('missing');
  // A run of several (a bulk button's), and which button started it: its label counts them.
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    kind: 'add' | 'add-unclaimed' | 'assign';
  } | null>(null);

  const load = useCallback(
    (name: string) => {
      setLoading(true);
      return fetchArmoryGuild(guild.id, name)
        .then((next) => {
          setRoster(next);
          setError(null);
        })
        .catch((err: unknown) => {
          setRoster(null);
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setLoading(false));
    },
    [guild.id],
  );
  useEffect(() => {
    void load(guildName);
  }, [load, guildName]);

  useEffect(() => {
    fetchPeople(guild.id)
      .then(setPeople)
      .catch(() => setPeople({ source: 'servers', people: [] }));
  }, [guild.id]);

  const suggestions = useMemo(() => {
    const found = new Map<string, Person>();
    for (const member of roster?.members ?? []) {
      // Those that need a player: not on the roster, or on it unclaimed.
      if (member.character && !unclaimedOnRoster(member)) continue;
      const person = suggestPlayer(member, people?.people ?? []);
      if (person) found.set(keyOf(member), person);
    }
    return found;
  }, [roster, people]);

  const pickOf = (member: ArmoryGuildMember): string =>
    picks.get(keyOf(member)) ?? suggestions.get(keyOf(member))?.discordUserId ?? '';

  const setState = (key: string, state: RowState | null) =>
    setStates((current) => {
      const next = new Map(current);
      if (state) next.set(key, state);
      else next.delete(key);
      return next;
    });

  const actionOf = (member: ArmoryGuildMember): Action | null => {
    const known = member.character;
    if (known?.inGuild) return !known.player && pickOf(member) !== '' ? 'assign' : null;
    if (known) return 'migrate';
    return pickOf(member) !== '' ? 'add' : 'add-unclaimed';
  };

  /**
   * Does a row's action; throws with a readable message. Says whether its role was assumed: when
   * the armory can't look the character up (its character pages lag behind the guild roster, or
   * never have some), it is added anyway from the guild roster's race, class and level, with its
   * class's first role.
   */
  const act = async (
    member: ArmoryGuildMember,
    action: Action,
  ): Promise<{ assumedRole: boolean }> => {
    if (action === 'migrate' && member.character) {
      await migrateCharacter(guild.id, member.character.id);
      return { assumedRole: false };
    }
    if (action === 'assign' && member.character) {
      await updateCharacter(guild.id, member.character.id, { discordUserId: pickOf(member) });
      return { assumedRole: false };
    }
    let character: { class: string; race: string; level: number; roles: Role[] };
    let assumedRole = false;
    try {
      // A lookup of its own: the roster has no talents, and this one works out its specs.
      const found = await fetchArmoryCharacter(guild.id, member.name, member.lastName);
      character = { ...found, roles: found.specs.roles };
    } catch {
      const role = firstRoleOfClass(game, member.class);
      character = { ...member, roles: role ? [role] : [] };
      assumedRole = true;
    }
    if (!character.class || !character.race) {
      throw new Error('The armory doesn’t say its class and race: add it with “Add character”.');
    }
    if (character.roles.length === 0) {
      throw new Error(`No roles are known for ${character.class}: add it with “Add character”.`);
    }
    await createCharacter(guild.id, {
      ...(action === 'add-unclaimed' ? { unclaimed: true } : { discordUserId: pickOf(member) }),
      name: member.lastName ? `${member.name}-${member.lastName}` : member.name,
      class: character.class,
      race: character.race,
      roles: character.roles,
      level: character.level,
    });
    return { assumedRole };
  };

  /** Does each row's action in turn (each row says how it went), then reads the armory again. */
  const run = async (
    batch: { member: ArmoryGuildMember; action: Action }[],
    kind: 'add' | 'add-unclaimed' | 'assign',
  ) => {
    const done: Record<Action, number> = { add: 0, 'add-unclaimed': 0, migrate: 0, assign: 0 };
    let assumed = 0;
    setProgress({ done: 0, total: batch.length, kind });
    for (const [i, { member, action }] of batch.entries()) {
      const key = keyOf(member);
      setState(key, { status: 'busy' });
      try {
        const { assumedRole } = await act(member, action);
        setState(key, null);
        done[action]++;
        if (assumedRole) assumed++;
      } catch (err) {
        setState(key, {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      setProgress({ done: i + 1, total: batch.length, kind });
    }
    setProgress(null);
    const total = Object.values(done).reduce((sum, n) => sum + n, 0);
    if (total === 0) return;
    const assumedNote =
      assumed === 0
        ? ''
        : batch.length === 1
          ? '. The armory couldn’t look it up, so its role is its class’s first: check it.'
          : `. ${assumed} couldn’t be looked up in the armory, so their role is their class’s first: check them.`;
    const one = batch.length === 1 ? batch[0] : null;
    const summary = one
      ? one.action === 'assign'
        ? `${fullName(one.member)} has its player now`
        : one.action === 'add-unclaimed'
          ? `${fullName(one.member)} is on the roster, unclaimed`
          : `${fullName(one.member)} is on the roster`
      : [
          done.add + done.migrate > 0 && `${done.add + done.migrate} added to the roster`,
          done['add-unclaimed'] > 0 && `${done['add-unclaimed']} added unclaimed`,
          done.assign > 0 && `${done.assign} given their player`,
        ]
          .filter(Boolean)
          .join(', ');
    showToast(summary + assumedNote, assumed > 0 ? 7000 : 3000);
    await load(guildName);
  };

  const lookUp = (event: FormEvent) => {
    event.preventDefault();
    const name = nameInput.trim();
    if (name === guildName) void load(name);
    else setGuildName(name);
  };

  const members = roster?.members ?? [];
  const missing = members.filter((m) => !m.character?.inGuild);
  const unclaimed = members.filter(unclaimedOnRoster);
  const shown = show === 'missing' ? missing : show === 'unclaimed' ? unclaimed : members;
  // The bulk buttons' rows: with a player (or known), without one, and unclaimed ones given one.
  const withAction = (rows: ArmoryGuildMember[], ...actions: Action[]) =>
    rows.flatMap((member) => {
      const action = actionOf(member);
      return action && actions.includes(action) ? [{ member, action }] : [];
    });
  const ready = withAction(missing, 'add', 'migrate');
  const noPlayer = withAction(missing, 'add-unclaimed');
  const toAssign = withAction(unclaimed, 'assign');
  const busy = progress !== null || [...states.values()].some((s) => s.status === 'busy');
  const bulkLabel = (kind: 'add' | 'add-unclaimed' | 'assign', idle: string) =>
    progress?.kind === kind
      ? `${kind === 'assign' ? 'Assigning' : 'Adding'} ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
      : idle;
  const otherFaction =
    roster && roster.faction && roster.faction.toUpperCase() !== guild.faction
      ? roster.faction
      : null;

  const playerCell = (member: ArmoryGuildMember) => {
    const known = member.character;
    if (known?.player) {
      return <DiscordName label={personLabel(known.player)} id={known.player.discordUserId} />;
    }
    // Another guild's unclaimed character: added as it is, still unclaimed.
    if (known && !known.inGuild) return <span className="muted">Unclaimed</span>;
    const key = keyOf(member);
    const suggestion = suggestions.get(key);
    return (
      <div className="field armory-import-player">
        <PlayerPicker
          guildId={guild.id}
          people={people ?? undefined}
          compact
          value={pickOf(member)}
          onChange={(id) => setPicks((current) => new Map(current).set(key, id))}
          self={{ discordId: currentUser.discordId, label: currentUser.displayName }}
          initial={
            suggestion
              ? { discordId: suggestion.discordUserId, label: personLabel(suggestion) }
              : undefined
          }
          pickedNote={
            suggestion && !picks.has(key)
              ? { text: 'guess', title: 'A guess, from their Discord name: check it is them' }
              : undefined
          }
        />
      </div>
    );
  };

  const actionCell = (member: ArmoryGuildMember) => {
    const known = member.character;
    if (known?.inGuild && known.player) {
      return (
        <Link
          className="btn btn-sm"
          to={guildPath(guild, `roster/edit/${known.id}`)}
          state={{ from: here }}
          title="Change it, or who plays it"
        >
          Edit
        </Link>
      );
    }
    const state = states.get(keyOf(member));
    const action = actionOf(member);
    // An unclaimed one on the roster with no one picked yet: nothing to do until someone is.
    const label =
      action === 'add'
        ? 'Import'
        : action === 'add-unclaimed'
          ? 'Add unclaimed'
          : action === 'migrate'
            ? 'Add to roster'
            : 'Assign';
    const title =
      action === 'add'
        ? 'Adds it to the roster for the Discord user picked'
        : action === 'add-unclaimed'
          ? 'No one picked: adds it with no player (Social), for its player to claim'
          : action === 'migrate'
            ? 'We know this character (in another guild): adds it to this roster as it is'
            : 'Gives this unclaimed character the Discord user picked';
    return (
      <button
        type="button"
        className={action === 'add-unclaimed' ? 'btn btn-sm' : 'btn btn-sm btn-primary'}
        disabled={busy || action === null}
        title={title}
        onClick={() =>
          action && void run([{ member, action }], action === 'assign' ? 'assign' : 'add')
        }
      >
        {state?.status === 'busy' ? (
          <InlineSpinner label={action === 'assign' ? 'Assigning…' : 'Adding…'} />
        ) : (
          label
        )}
      </button>
    );
  };

  const statusLine = (member: ArmoryGuildMember) => {
    const state = states.get(keyOf(member));
    if (state?.status === 'error') {
      // One line, like every row's status: the whole message on hover, or as a note on a click.
      return <OneLine text={state.message} className="status-error" />;
    }
    const known = member.character;
    if (known?.inGuild) {
      return (
        <span className="muted">{known.player ? 'On the roster' : 'On the roster, unclaimed'}</span>
      );
    }
    if (known) {
      return (
        <span className="muted">
          {known.player ? 'Known, in another guild' : 'Known, unclaimed, in another guild'}
        </span>
      );
    }
    return <span className="muted">Not on the roster</span>;
  };

  const body = () => {
    if (loading && !roster) return <Spinner />;
    if (error) return <p className="status-error">{error}</p>;
    if (!roster) return null;
    if (members.length === 0)
      return <p className="empty">The armory lists no members for {roster.name}.</p>;
    return (
      <>
        <p className="muted">
          {members.length} member{members.length === 1 ? '' : 's'} of {roster.name} in the{' '}
          {guild.region} armory: {members.length - missing.length} on the roster
          {unclaimed.length > 0 && ` (${unclaimed.length} unclaimed)`}, {missing.length} not.
          {loading && (
            <>
              {' '}
              <InlineSpinner />
            </>
          )}
        </p>
        {otherFaction && (
          <div className="banner banner-error" role="alert">
            <span>
              The armory’s {roster.name} is {otherFaction}, and this guild is not: its races won’t
              fit. Check the guild’s name in the game.
            </span>
          </div>
        )}
        {people?.source === 'known' && (
          <p className="muted">
            Only players we already know can be picked: Discord did not allow listing the servers’
            members (the bot’s Server Members Intent is off).
          </p>
        )}
        <div className="armory-import-bar">
          <div className="view-tabs armory-import-tabs" role="tablist" aria-label="Which members">
            {(
              [
                ['missing', `Not on the roster (${missing.length})`],
                ['unclaimed', `Unclaimed (${unclaimed.length})`],
                ['all', `Everyone (${members.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={show === value}
                onClick={() => setShow(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="armory-import-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || noPlayer.length === 0}
              title="Adds every character no one is picked for, with no player (Social), for their players to claim"
              onClick={() => void run(noPlayer, 'add-unclaimed')}
            >
              {bulkLabel('add-unclaimed', `Add ${noPlayer.length} unclaimed`)}
            </button>
            {unclaimed.length > 0 && (
              <button
                type="button"
                className="btn"
                disabled={busy || toAssign.length === 0}
                title="Gives every unclaimed character on the roster the Discord user picked"
                onClick={() => void run(toAssign, 'assign')}
              >
                {bulkLabel('assign', `Assign ${toAssign.length}`)}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || ready.length === 0}
              title="Adds every character that has a Discord user, one after the other"
              onClick={() => void run(ready, 'add')}
            >
              {bulkLabel('add', `Add ${ready.length} to the roster`)}
            </button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="empty">
            {show === 'unclaimed'
              ? 'Every character on the roster has its player.'
              : `Every member of ${roster.name} in the armory is on the roster.`}
          </p>
        ) : (
          <div className="table-wrap armory-import-table">
            <table>
              <thead>
                <tr>
                  <th>Character</th>
                  <th>Class</th>
                  <th>Race</th>
                  <th>Level</th>
                  <th>Guild rank</th>
                  <th>Discord user</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((member) => {
                  const link = armoryLinkFor(game, {
                    name: member.name,
                    lastName: member.lastName,
                    region: guild.region,
                    server: guild.realm,
                  });
                  return (
                    <tr
                      key={keyOf(member)}
                      className={
                        states.get(keyOf(member))?.status === 'busy' ? 'row-pending' : undefined
                      }
                    >
                      <td data-label="Character" className="cell-name">
                        <div>
                          {link ? (
                            <a href={link} target="_blank" rel="noreferrer" title="Its armory page">
                              <strong>{fullName(member)}</strong>
                            </a>
                          ) : (
                            <strong>{fullName(member)}</strong>
                          )}
                        </div>
                        <small>{statusLine(member)}</small>
                      </td>
                      <td data-label="Class" className="cell-compact">
                        <ClassMark
                          gameVersion={guild.gameVersion}
                          className={member.class || null}
                        />
                        {member.class || '—'}
                      </td>
                      <td data-label="Race">{member.race || '—'}</td>
                      <td data-label="Level" className="cell-compact cell-level">
                        {member.level}
                      </td>
                      <td data-label="Guild rank" className="cell-compact">
                        {rankLabel(member.rank)}
                      </td>
                      <td data-label="Discord user">{playerCell(member)}</td>
                      <td className="cell-actions">{actionCell(member)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="tasks">
      <Link className="back-link" to={back}>
        ← Roster
      </Link>
      <div className="tasks-head">
        <div>
          <h3>Import from armory</h3>
          <p className="muted">
            The guild’s members in Blizzard’s armory. Pick who plays each one that isn’t on the
            roster and add it: race, class and level come from the armory, roles from its talents
            (check them after). A player marked “(guess)” has the character’s name as their Discord
            name: check it’s them. No one to pick? Add it unclaimed: it shows on the roster as
            Social, never in sign-ups or assignments, until its player claims it.
          </p>
        </div>
      </div>
      <form className="armory-import-lookup" onSubmit={lookUp}>
        <label className="field">
          Guild in the armory
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={guild.name}
            aria-describedby="armory-guild-name-help"
          />
        </label>
        <button type="submit" className="btn" disabled={loading || busy || nameInput.trim() === ''}>
          {loading ? 'Looking up…' : 'Look up'}
        </button>
        <small id="armory-guild-name-help" className="muted">
          Its name as in the game, if it isn’t {guild.name}.
        </small>
      </form>
      {body()}
    </div>
  );
}
