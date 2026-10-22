import { useEffect, useState, type FormEvent } from 'react';
import { createGuild, fetchEligibleServers, syncDiscord } from './api';
import { factionsOf, gameOf, regionsOf, serversFor, useGames } from './game';
import { RegionSelect } from './RegionSelect';
import { SetupInstructions } from './SetupInstructions';
import type { EligibleServers, Faction, Guild, SetupInfo } from './types';
import { Select } from './Select';
import { GuildIcon } from './GuildIcon';
import './createGuild.css';

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
            <Select value={gameVersion} onChange={(v) => setGameVersion(v)}>
              {games.map((g) => (
                <option key={g.gameVersion}>{g.gameVersion}</option>
              ))}
            </Select>
          </label>
          <RegionSelect regions={regions} value={region} onChange={setRegion} />
          <label className="field">
            Server
            <Select value={realm} onChange={(v) => setRealm(v)} required>
              {servers.map((server) => (
                <option key={server}>{server}</option>
              ))}
            </Select>
          </label>
          <label className="field">
            Faction
            <Select value={faction} onChange={(v) => setFaction(v as Faction)}>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
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
            // Each server as a card like the overview's guild cards: its picture (the guild's logo
            // when it is the main server) and name; a click picks it.
            <div className="guild-grid server-cards">
              {eligible.servers.map((server) => {
                const picked = selected.includes(server.discordId);
                return (
                  <div
                    key={server.discordId}
                    className={
                      picked
                        ? 'guild-card server-card server-card-picked'
                        : 'guild-card server-card'
                    }
                  >
                    <label className="server-card-pick">
                      <GuildIcon
                        guild={{ name: server.name, servers: [{ ...server, isMain: true }] }}
                      />
                      <span className="guild-card-text">
                        <strong>{server.name}</strong>
                        <span className="muted">{picked ? 'In this guild' : 'Not added'}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => toggle(server.discordId)}
                      />
                    </label>
                    {selected.length > 1 && picked && (
                      <label
                        className="server-card-main"
                        title="The main server's picture is the guild's logo"
                      >
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
                );
              })}
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
