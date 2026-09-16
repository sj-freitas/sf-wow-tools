import { useEffect, useState } from 'react';
import { fetchPlayers } from './api';
import type { Player } from './types';

export function PlayersPage() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPlayers()
      .then(setPlayers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return <p className="status status-error">Failed to load players: {error}</p>;
  }

  if (!players) {
    return <p className="status">Loading players…</p>;
  }

  if (players.length === 0) {
    return <p className="status">No players found.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Realm</th>
          <th>Class</th>
          <th>Level</th>
          <th>Faction</th>
        </tr>
      </thead>
      <tbody>
        {players.map((player) => (
          <tr key={player.id}>
            <td>{player.name}</td>
            <td>{player.realm}</td>
            <td>{player.class}</td>
            <td>{player.level}</td>
            <td>{player.faction}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
