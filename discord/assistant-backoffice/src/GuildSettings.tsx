import { useEffect, useState, type FormEvent } from 'react';
import {
  addGuildServer,
  deleteGuild,
  fetchEligibleServers,
  fetchRoleOptions,
  removeGuildServer,
  syncDiscord,
  setMainServer,
  setOfficerRole,
  setRoleMapping,
  updateGuild,
} from './api';
import {
  GAME_VERSIONS,
  type EligibleServers,
  type Faction,
  type Guild,
  type RoleOption,
} from './types';

interface Props {
  guild: Guild;
  /** Called after any change so the parent can reload guilds. */
  onChanged: () => Promise<void>;
  onClose: () => void;
}

export function GuildSettings({ guild, onChanged, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);

  const run = (action: Promise<unknown>) => {
    setError(null);
    return action
      .then(onChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <div className="settings">
      <div className="settings-header">
        <h3>Manage guild</h3>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <p className="status-error">{error}</p>}

      <DetailsSection guild={guild} run={run} />
      <ServersSection guild={guild} run={run} />
      <RolesSection guild={guild} run={run} />

      <section className="settings-section danger-zone">
        <h4>Delete guild</h4>
        <p className="muted">
          Permanently deletes the guild with all its players and characters. Its Discord servers
          become free to use for another guild.
        </p>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            if (
              window.confirm(
                `Delete "${guild.name}" and all of its characters? This cannot be undone.`,
              )
            ) {
              void run(deleteGuild(guild.id).then(onClose));
            }
          }}
        >
          Delete guild
        </button>
      </section>
    </div>
  );
}

interface SectionProps {
  guild: Guild;
  run: (action: Promise<unknown>) => Promise<void>;
}

function DetailsSection({ guild, run }: SectionProps) {
  const [name, setName] = useState(guild.name);
  const [realm, setRealm] = useState(guild.realm);
  const [faction, setFaction] = useState<Faction>(guild.faction);
  const [gameVersion, setGameVersion] = useState(guild.gameVersion);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(
      updateGuild(guild.id, { name: name.trim(), realm: realm.trim(), faction, gameVersion }),
    );
  };

  return (
    <form className="settings-section" onSubmit={handleSubmit}>
      <h4>Details</h4>
      <div className="form-grid">
        <label className="field">
          Guild name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required />
        </label>
        <label className="field">
          Realm
          <input value={realm} onChange={(e) => setRealm(e.target.value)} maxLength={64} required />
        </label>
        <label className="field">
          Faction
          <select value={faction} onChange={(e) => setFaction(e.target.value as Faction)}>
            <option value="ALLIANCE">Alliance</option>
            <option value="HORDE">Horde</option>
          </select>
        </label>
        <label className="field">
          Game version
          <select value={gameVersion} onChange={(e) => setGameVersion(e.target.value)}>
            {GAME_VERSIONS.map((version) => (
              <option key={version}>{version}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          Save details
        </button>
      </div>
    </form>
  );
}

function ServersSection({ guild, run }: SectionProps) {
  const [eligible, setEligible] = useState<EligibleServers | null>(null);
  const [toAdd, setToAdd] = useState('');

  useEffect(() => {
    // Re-read the user's servers from Discord first, so newly set-up servers show up.
    syncDiscord()
      .then(fetchEligibleServers)
      .then(setEligible)
      .catch(() => setEligible({ servers: [] }));
  }, [guild.servers.length]);

  return (
    <section className="settings-section">
      <h4>Discord servers</h4>
      <p className="muted">
        The guild keeps at least one server. The <strong>main</strong> server is where the Officer
        role is looked up.
      </p>
      <ul className="settings-list">
        {guild.servers.map((server) => (
          <li key={server.discordId}>
            <span>
              {server.name || server.discordId}{' '}
              {server.isMain && <span className="badge badge-admin">Main</span>}
            </span>
            <span className="settings-actions">
              {!server.isMain && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void run(setMainServer(guild.id, server.discordId))}
                >
                  Make main
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={server.isMain || guild.servers.length === 1}
                title={
                  server.isMain
                    ? 'Make another server the main one first'
                    : guild.servers.length === 1
                      ? 'A guild needs at least one server'
                      : 'Remove this server from the guild'
                }
                onClick={() => void run(removeGuildServer(guild.id, server.discordId))}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="inline-form">
        <select value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
          <option value="">
            {eligible === null
              ? 'Loading your servers…'
              : eligible.servers.length === 0
                ? 'No servers available to add'
                : 'Add a server…'}
          </option>
          {eligible?.servers.map((server) => (
            <option key={server.discordId} value={server.discordId}>
              {server.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={toAdd === ''}
          onClick={() => void run(addGuildServer(guild.id, toAdd).then(() => setToAdd('')))}
        >
          Add server
        </button>
      </div>
    </section>
  );
}

function RolesSection({ guild, run }: SectionProps) {
  const [options, setOptions] = useState<RoleOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mainServer = guild.servers.find((server) => server.isMain);

  useEffect(() => {
    fetchRoleOptions(guild.id)
      .then(setOptions)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, mainServer?.discordId]);

  return (
    <section className="settings-section">
      <h4>Discord roles</h4>
      <p className="muted">
        Roles of the main server ({mainServer?.name ?? 'none'}) that stand for guild roles. Changes
        to the Officer role reach officers within a few minutes.
      </p>
      {loadError ? (
        <p className="status-error">{loadError}</p>
      ) : (
        <div className="role-rows">
          <RoleRow
            title="Officer"
            hint="Can add, edit and remove every player's characters and configure the guild."
            current={guild.officerRole}
            options={options}
            editable
            onSave={(roleId) => run(setOfficerRole(guild.id, roleId))}
          />
          <RoleRow
            title="Raider"
            hint="Optional. Helps with the roster setup later."
            current={guild.roleMappings.RAIDER}
            options={options}
            editable={guild.isOfficer}
            onSave={(roleId) => run(setRoleMapping(guild.id, 'RAIDER', roleId))}
          />
          <RoleRow
            title="Social"
            hint="Optional. Helps with the roster setup later."
            current={guild.roleMappings.SOCIAL}
            options={options}
            editable={guild.isOfficer}
            onSave={(roleId) => run(setRoleMapping(guild.id, 'SOCIAL', roleId))}
          />
        </div>
      )}
    </section>
  );
}

interface RoleRowProps {
  title: string;
  hint: string;
  current: { id: string; name: string } | null;
  options: RoleOption[] | null;
  /** Read-only when the current user isn't allowed to change this mapping. */
  editable: boolean;
  onSave: (roleId: string | null) => Promise<void>;
}

function RoleRow({ title, hint, current, options, editable, onSave }: RoleRowProps) {
  const [roleId, setRoleId] = useState(current?.id ?? '');

  useEffect(() => setRoleId(current?.id ?? ''), [current?.id]);

  return (
    <div className="role-row">
      <div>
        <strong>{title}</strong>
        <div className="muted">{hint}</div>
      </div>
      {editable ? (
        <div className="inline-form">
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">{options === null ? 'Loading roles…' : 'Not set'}</option>
            {options?.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={roleId === (current?.id ?? '')}
            onClick={() => void onSave(roleId === '' ? null : roleId)}
          >
            Save
          </button>
        </div>
      ) : (
        <span>
          {current?.name ?? 'Not set'}
          <span className="muted"> (only Officers can change this)</span>
        </span>
      )}
    </div>
  );
}
