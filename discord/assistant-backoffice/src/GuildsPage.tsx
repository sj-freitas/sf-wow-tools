import { useCallback, useEffect, useState } from 'react';
import { deleteCharacter, fetchPlayers, removeGuildServer, updateCharacter } from './api';
import { AddCharacterForm } from './AddCharacterForm';
import { CreateGuildForm } from './CreateGuildForm';
import { ROLE_LABELS, type Guild, type Player } from './types';

interface Props {
  guilds: Guild[];
  onGuildsChanged: () => Promise<void>;
}

export function GuildsPage({ guilds, onGuildsChanged }: Props) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(guilds[0]?.id);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetchPlayers()
      .then(setPlayers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);

  const run = (action: Promise<void>) => {
    action
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const guild = guilds.find((g) => g.id === selectedId) ?? guilds[0];

  const createGuildPanel = creating && (
    <CreateGuildForm
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
              <span className={`badge ${guild.isAdmin ? 'badge-admin' : ''}`}>
                {guild.isAdmin ? 'Guild Assistant' : 'Member'}
              </span>
            </div>
            <div className="card-meta">
              {guild.realm} · {guild.gameVersion} · {guildPlayers.length} player
              {guildPlayers.length === 1 ? '' : 's'}
            </div>
          </div>
          {guild.isAdmin && !adding && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              + Add character
            </button>
          )}
        </div>

        <div className="server-list">
          {guild.servers.map((server) => (
            <span key={server.discordId} className="server-chip">
              {server.name || server.discordId}
              {guild.isAdmin && (
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`Remove server ${server.name}`}
                  title={
                    guild.servers.length === 1
                      ? 'A guild needs at least one server'
                      : 'Remove this server from the guild'
                  }
                  disabled={guild.servers.length === 1}
                  onClick={() =>
                    run(removeGuildServer(guild.id, server.discordId).then(onGuildsChanged))
                  }
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>

        {adding && (
          <AddCharacterForm
            guild={guild}
            onAdded={() => {
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
                  {guild.isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ player, character }) => (
                  <tr key={character.id}>
                    <td>
                      {`${character.firstName} ${character.lastName}`.trim()}{' '}
                      {character.isMain && <span className="badge badge-main">Main</span>}
                    </td>
                    <td>{character.class}</td>
                    <td>{character.roles.map((role) => ROLE_LABELS[role]).join(', ')}</td>
                    <td>{character.level}</td>
                    <td className="muted">{player.discordUserId}</td>
                    {guild.isAdmin && (
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            run(updateCharacter(character.id, { isMain: !character.isMain }))
                          }
                        >
                          {character.isMain ? 'Unset main' : 'Set main'}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
