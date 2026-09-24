import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { deleteCharacter, fetchPlayers } from './api';
import { CharacterForm } from './CharacterForm';
import { CreateGuildForm } from './CreateGuildForm';
import { playerLabel } from './format';
import { GuildSettings } from './GuildSettings';
import { SetupInstructions } from './SetupInstructions';
import { ROLE_LABELS, type Guild, type Player, type SetupInfo } from './types';

interface Props {
  guilds: Guild[];
  setup: SetupInfo;
  onGuildsChanged: () => Promise<void>;
}

export function GuildsPage({ guilds, setup, onGuildsChanged }: Props) {
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

  const access = guild.isAdmin
    ? {
        label: setup.adminRoleName,
        hint: `You hold ${setup.adminRoleName} in every server of this guild: full control, including the main server and Officer role.`,
      }
    : guild.isOfficer
      ? {
          label: 'Officer',
          hint: `You hold the guild's Officer role (${guild.officerRole?.name ?? ''}): you can manage the guild, except for the main server and Officer role.`,
        }
      : {
          label: 'Member',
          hint: 'You can view this guild. Managing it needs the Officer role, or the Guild-Assistant role in all its servers.',
        };

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
              <span className={`badge ${guild.canManage ? 'badge-admin' : ''}`} title={access.hint}>
                Your access: {access.label}
              </span>
            </div>
            <div className="card-meta">
              {guild.realm} · {guild.gameVersion} · {guildPlayers.length} player
              {guildPlayers.length === 1 ? '' : 's'}
            </div>
          </div>
          {guild.canManage && (
            <div className="settings-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setManaging((current) => !current)}
              >
                {managing ? 'Hide settings' : 'Manage guild'}
              </button>
              {!adding && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setEditingId(null);
                    setAdding(true);
                  }}
                >
                  + Add character
                </button>
              )}
            </div>
          )}
        </div>

        <div className="server-list">
          {guild.servers.map((server) => (
            <span key={server.discordId} className="server-chip">
              {server.name || server.discordId}
              {server.isMain && guild.servers.length > 1 && <span className="badge">Main</span>}
            </span>
          ))}
        </div>

        {managing && guild.canManage && (
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
                  {guild.canManage && <th />}
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
                      {guild.canManage && (
                        <td className="cell-actions">
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
                        </td>
                      )}
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
