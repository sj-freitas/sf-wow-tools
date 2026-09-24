import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { deleteCharacter, fetchCurrentUser, fetchPlayers, redirectToLogin } from './api';
import { CharacterForm } from './CharacterForm';
import { CreateGuildForm } from './CreateGuildForm';
import { playerLabel } from './format';
import { GuildSettings } from './GuildSettings';
import { SetupInstructions } from './SetupInstructions';
import { ROLE_LABELS, type Guild, type Player, type SetupInfo, type User } from './types';

interface Props {
  guilds: Guild[];
  setup: SetupInfo;
  currentUser: User;
  onGuildsChanged: () => Promise<void>;
}

export function GuildsPage({ guilds, setup, currentUser, onGuildsChanged }: Props) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(guilds[0]?.id);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);

  const load = useCallback(() => {
    fetchPlayers()
      .then(setPlayers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);

  const guildsChanged = useRef(onGuildsChanged);
  useEffect(() => {
    guildsChanged.current = onGuildsChanged;
  }, [onGuildsChanged]);

  // Live updates: the API pushes an event whenever a guild we can see changes.
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('characters', load);
    source.addEventListener('guild', () => {
      load();
      guildsChanged.current().catch(() => undefined);
    });
    source.onerror = () => {
      // The browser gives no status code: if the stream was closed, check whether we were logged out.
      if (source.readyState === EventSource.CLOSED) {
        void fetchCurrentUser().then((user) => (user ? undefined : redirectToLogin()));
      }
    };
    return () => source.close();
  }, [load]);

  const run = (action: Promise<void>) => {
    action
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const guild = guilds.find((g) => g.id === selectedId) ?? guilds[0];

  const createGuildPanel = creating && (
    <CreateGuildForm
      setup={setup}
      onCancel={() => setCreating(false)}
      onCreated={(created) => {
        setCreating(false);
        setSelectedId(created.id);
        run(onGuildsChanged());
      }}
    />
  );

  if (!guild) {
    return (
      <>
        {createGuildPanel}
        {!creating && (
          <div className="card empty">
            <p>
              None of your Discord servers belong to a guild that uses Guild Assistant yet. Create
              one to get started.
            </p>
            <SetupInstructions setup={setup} />
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              + Create guild
            </button>
          </div>
        )}
      </>
    );
  }
  if (error) {
    return <p className="status status-error">Failed: {error}</p>;
  }
  if (!players) {
    return <p className="status">Loading players…</p>;
  }

  const guildPlayers = players.filter((player) => player.guildId === guild.id);
  const rows = guildPlayers.flatMap((player) =>
    player.characters.map((character) => ({ player, character })),
  );

  const accessLabels = [
    ...(guild.isAdmin ? [setup.adminRoleName] : []),
    ...(guild.isOfficer ? ['Officer'] : []),
  ];
  const accessHint = [
    guild.isAdmin &&
      `${setup.adminRoleName} (in every server of this guild): configure the guild, its servers and its Officer role.`,
    guild.isOfficer &&
      `Officer (${guild.officerRole?.name ?? ''}): add, edit and remove every player's characters.`,
    "Everyone in one of the guild's servers: add and edit their own characters.",
  ]
    .filter(Boolean)
    .join('\n');
  const canEditRow = (player: Player) =>
    guild.isOfficer || player.discordUserId === currentUser.discordId;

  return (
    <>
      <div className="topbar">
        <div className="tabs" role="tablist">
          {guilds.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={g.id === guild.id}
              onClick={() => {
                setSelectedId(g.id);
                setAdding(false);
                setEditingId(null);
                setManaging(false);
              }}
            >
              {g.name}
            </button>
          ))}
        </div>
        {!creating && (
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            + Create guild
          </button>
        )}
      </div>
      {createGuildPanel}

      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title">
              <h2>{guild.name}</h2>
              <span className={`badge badge-${guild.faction.toLowerCase()}`}>{guild.faction}</span>
              <span
                className={`badge ${accessLabels.length > 0 ? 'badge-admin' : ''}`}
                title={accessHint}
              >
                Your access: {accessLabels.length > 0 ? accessLabels.join(' + ') : 'Member'}
              </span>
            </div>
            <div className="card-meta">
              {guild.realm} · {guild.gameVersion} · {guildPlayers.length} player
              {guildPlayers.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="settings-actions">
            {guild.isAdmin && (
              <button
                type="button"
                className="btn"
                onClick={() => setManaging((current) => !current)}
              >
                {managing ? 'Hide settings' : 'Manage guild'}
              </button>
            )}
            {!adding && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setEditingId(null);
                  setAdding(true);
                }}
              >
                {guild.isOfficer ? '+ Add character' : '+ Add my character'}
              </button>
            )}
          </div>
        </div>

        <div className="server-list">
          {guild.servers.map((server) => (
            <span key={server.discordId} className="server-chip">
              {server.name || server.discordId}
              {server.isMain && guild.servers.length > 1 && <span className="badge">Main</span>}
            </span>
          ))}
        </div>

        {managing && guild.isAdmin && (
          <GuildSettings
            key={guild.id}
            guild={guild}
            onChanged={async () => {
              await onGuildsChanged();
              load();
            }}
            onClose={() => setManaging(false)}
          />
        )}

        {adding && (
          <CharacterForm
            guild={guild}
            onSaved={() => {
              setAdding(false);
              load();
            }}
            onCancel={() => setAdding(false)}
          />
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
                      <td className="cell-actions">
                        {canEditRow(player) && (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                setAdding(false);
                                setEditingId(character.id);
                              }}
                            >
                              Edit
                            </button>{' '}
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
                    {editingId === character.id && (
                      <tr className="edit-row">
                        <td colSpan={6}>
                          <CharacterForm
                            guild={guild}
                            editing={{ character, playerLabel: playerLabel(player) }}
                            onSaved={() => {
                              setEditingId(null);
                              load();
                            }}
                            onCancel={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
