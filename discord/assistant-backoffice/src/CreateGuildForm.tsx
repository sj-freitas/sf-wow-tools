import { useEffect, useState, type FormEvent } from 'react';
import { createGuild, fetchEligibleServers, syncDiscord } from './api';
import { factionsOf, gameOf, regionsOf, serversFor, useGames } from './game';
import { RegionSelect } from './RegionSelect';
import { SetupInstructions } from './SetupInstructions';
import type { EligibleServers, Faction, Guild, SetupInfo } from './types';

interface Props {
  setup: SetupInfo;
  onCreated: (guild: Guild) => void;
  onCancel: () => void;
}

export function CreateGuildForm({ setup, onCreated, onCancel }: Props) {
  const [eligible, setEligible] = useState<EligibleServers | null>(null);
  const [name, setName] = useState('');
  const games = useGames();
  const [chosenRealm, setRealm] = useState('');
  const [chosenFaction, setFaction] = useState<Faction>('ALLIANCE');
  const [gameVersion, setGameVersion] = useState<string>(games[0]?.gameVersion ?? '');
  const [chosenRegion, setRegion] = useState(setup.regions[0]?.id ?? 'EU');
  // What the version allows: its regions, the servers of the region, its factions. A choice that
  // the version does not offer (after switching version or region) falls back to the first one.
  const game = gameOf(games, gameVersion);
  const regions = setup.regions.filter((r) => regionsOf(game).includes(r.id));
  const region = regions.some((r) => r.id === chosenRegion) ? chosenRegion : (regions[0]?.id ?? '');
  const servers = serversFor(game, region);
  const realm = servers.includes(chosenRealm) ? chosenRealm : (servers[0] ?? '');
  const factions = factionsOf(game);
  const faction = factions.some((f) => f.id === chosenFaction)
    ? chosenFaction
    : (factions[0]?.id ?? chosenFaction);
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
      realm,
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
            Game version
            <select value={gameVersion} onChange={(e) => setGameVersion(e.target.value)}>
              {games.map((g) => (
                <option key={g.gameVersion}>{g.gameVersion}</option>
              ))}
            </select>
          </label>
          <RegionSelect regions={regions} value={region} onChange={setRegion} />
          <label className="field">
            Server
            <select value={realm} onChange={(e) => setRealm(e.target.value)} required>
              {servers.map((server) => (
                <option key={server}>{server}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Faction
            <select value={faction} onChange={(e) => setFaction(e.target.value as Faction)}>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
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
          <button
            type="submit"
            className="btn btn-primary"
            disabled={selected.length === 0 || realm === ''}
          >
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
