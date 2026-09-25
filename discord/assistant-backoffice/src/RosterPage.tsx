import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteCharacter, fetchPlayers, fetchRanks, refreshPlayerNames } from './api';
import { CharacterForm } from './CharacterForm';
import { subscribeEvents } from './events';
import { playerLabel } from './format';
import { ROLE_LABELS, type Guild, type Player, type Ranks, type User } from './types';
import { useCurrentUrl, useReturnTo } from './useReturnTo';
import { guildPath } from './guildPath';

interface Props {
  guild: Guild;
  currentUser: User;
}

/** Everyone in the guild sees the roster; Officers manage every character, members their own. */
export function RosterPage({ guild, currentUser }: Props) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [ranks, setRanks] = useState<Ranks>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const here = useCurrentUrl();

  const load = useCallback(() => {
    fetchPlayers(guild.id)
      .then((loaded) => {
        setPlayers(loaded);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [guild.id]);

  // Ranks are read live from Discord roles and are optional decoration.
  const loadRanks = useCallback(() => {
    fetchRanks(guild.id)
      .then(setRanks)
      .catch(() => setRanks({}));
  }, [guild.id]);

  useEffect(load, [load]);
  useEffect(loadRanks, [loadRanks]);
  // Discord roles change outside the app: look again every minute while the page is open.
  useEffect(() => {
    const timer = setInterval(loadRanks, 60_000);
    return () => clearInterval(timer);
  }, [loadRanks]);
  useEffect(() => subscribeEvents('characters', load), [load]);
  useEffect(
    () =>
      subscribeEvents('guild', () => {
        load();
        loadRanks();
      }),
    [load, loadRanks],
  );

  const run = (action: Promise<unknown>) => {
    setActionError(null);
    action
      .then(load)
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
  };

  if (loadError && !players) {
    return (
      <div className="status status-error">
        <p>Could not load players: {loadError}</p>
        <button type="button" className="btn" onClick={load}>
          Retry
        </button>
      </div>
    );
  }
  if (!players) return <p className="status">Loading players…</p>;

  const rows = players.flatMap((player) =>
    player.characters.map((character) => ({ player, character })),
  );
  const missingNames = players.some(
    (player) => !player.discordUsername && !player.discordDisplayName,
  );
  const canEditRow = (player: Player) =>
    guild.isOfficer || player.discordUserId === currentUser.discordId;

  return (
    <div className="tasks">
      <div className="tasks-head">
        <div>
          <h3>Roster</h3>
          <span className="muted">
            {players.length} player{players.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="settings-actions">
          {guild.isOfficer && missingNames && (
            <button
              type="button"
              className="btn"
              title="Look up the Discord usernames of players we only know by ID"
              onClick={() => run(refreshPlayerNames(guild.id))}
            >
              Refresh names
            </button>
          )}
          <Link
            className="btn btn-primary"
            to={guildPath(guild, 'roster/create')}
            state={{ from: here }}
          >
            {guild.isOfficer ? '+ Add character' : '+ Add my character'}
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="banner banner-error" role="alert">
          <span>{actionError}</span>
          <button type="button" className="btn btn-sm" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="empty">No characters registered yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th>Class</th>
                <th>Roles</th>
                <th>Level</th>
                <th>Discord user</th>
                <th>Rank</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ player, character }) => (
                <Fragment key={character.id}>
                  <tr>
                    <td>
                      {`${character.firstName} ${character.lastName}`.trim()}{' '}
                      {character.isMain && <span className="badge badge-main">Main</span>}
                    </td>
                    <td>{character.class}</td>
                    <td>{character.roles.map((role) => ROLE_LABELS[role]).join(', ')}</td>
                    <td>{character.level}</td>
                    <td>
                      {playerLabel(player)}
                      {playerLabel(player) !== player.discordUserId && (
                        <span className="muted"> · {player.discordUserId}</span>
                      )}
                    </td>
                    <td>{ranks[player.discordUserId]?.join(', ') ?? '—'}</td>
                    <td className="cell-actions">
                      {canEditRow(player) && (
                        <>
                          <Link
                            className="btn btn-sm"
                            to={guildPath(guild, `roster/edit/${character.id}`)}
                            state={{ from: here }}
                          >
                            Edit
                          </Link>{' '}
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => run(deleteCharacter(character.id))}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** `/roster/create` and `/roster/edit/:characterId`: the character form on its own page. */
export function CharacterEditorPage({ guild, currentUser }: Props) {
  const { characterId } = useParams();
  const navigate = useNavigate();
  const back = useReturnTo(guildPath(guild, 'roster'));
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!characterId) return;
    fetchPlayers(guild.id)
      .then(setPlayers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, characterId]);

  const found = characterId
    ? players
        ?.flatMap((player) => player.characters.map((character) => ({ player, character })))
        .find((row) => row.character.id === characterId)
    : undefined;

  const body = () => {
    if (!characterId) {
      return (
        <CharacterForm
          guild={guild}
          onSaved={() => navigate(back)}
          onCancel={() => navigate(back)}
        />
      );
    }
    if (error) return <p className="status-error">{error}</p>;
    if (!players) return <p className="empty">Loading…</p>;
    if (!found) return <p className="empty">That character was not found in this guild.</p>;
    const mayEdit = guild.isOfficer || found.player.discordUserId === currentUser.discordId;
    if (!mayEdit) return <p className="empty">You can only edit your own characters.</p>;
    return (
      <CharacterForm
        guild={guild}
        editing={{ character: found.character, playerLabel: playerLabel(found.player) }}
        onSaved={() => navigate(back)}
        onCancel={() => navigate(back)}
      />
    );
  };

  return (
    <div className="tasks">
      <Link className="back-link" to={back}>
        ← Roster
      </Link>
      {body()}
    </div>
  );
}
