import { useEffect, useState, type FormEvent } from 'react';
import { createGuild, fetchEligibleServers, syncDiscord } from './api';
import { RegionSelect } from './RegionSelect';
import { SetupInstructions } from './SetupInstructions';
import {
  GAME_VERSIONS,
  type EligibleServers,
  type Faction,
  type Guild,
  type SetupInfo,
} from './types';

interface Props {
  setup: SetupInfo;
  onCreated: (guild: Guild) => void;
  onCancel: () => void;
}

export function CreateGuildForm({ setup, onCreated, onCancel }: Props) {
  const [eligible, setEligible] = useState<EligibleServers | null>(null);
  const [name, setName] = useState('');
  const [realm, setRealm] = useState('');
  const [faction, setFaction] = useState<Faction>('ALLIANCE');
  const [gameVersion, setGameVersion] = useState<string>(GAME_VERSIONS[0]);
  const [region, setRegion] = useState(setup.regions[0]?.id ?? 'EU');
  const [selected, setSelected] = useState<string[]>([]);
  const [mainId, setMainId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    syncDiscord()
      .then(fetchEligibleServers)
      .then(setEligible)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );

  const effectiveMain = selected.includes(mainId) ? mainId : selected[0];

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createGuild({
      name: name.trim(),
      realm: realm.trim(),
      faction,
      gameVersion,
      region,
      discordServerIds: selected,
      mainServerId: effectiveMain,
    })
      .then(onCreated)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>Create guild</h2>
      </div>
      <form className="card-body" onSubmit={handleSubmit}>
        <SetupInstructions setup={setup} />
        <div className="form-grid">
          <label className="field">
            Guild name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required />
          </label>
          <label className="field">
            Realm
            <input
              value={realm}
              onChange={(e) => setRealm(e.target.value)}
              maxLength={64}
              required
            />
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
          <RegionSelect regions={setup.regions} value={region} onChange={setRegion} />
        </div>

        <div className="field server-picker">
          Discord servers
          {!eligible && !error && <span>Loading your servers…</span>}
          {eligible && eligible.servers.length === 0 && (
            <span className="muted">
              No servers available. Follow the steps above: the bot must be in the server, you need
              the <strong>{setup.adminRoleName}</strong> role there, and the server must not belong
              to a guild yet. This list was just refreshed from Discord.
            </span>
          )}
          {eligible && eligible.servers.length > 0 && (
            <div className="checks checks-column">
              {eligible.servers.map((server) => (
                <div key={server.discordId} className="server-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(server.discordId)}
                      onChange={() => toggle(server.discordId)}
                    />
                    {server.name}
                  </label>
                  {selected.length > 1 && selected.includes(server.discordId) && (
                    <label className="main-pick">
                      <input
                        type="radio"
                        name="main-server"
                        checked={effectiveMain === server.discordId}
                        onChange={() => setMainId(server.discordId)}
                      />
                      Main server
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="status-error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={selected.length === 0}>
            Create guild
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
