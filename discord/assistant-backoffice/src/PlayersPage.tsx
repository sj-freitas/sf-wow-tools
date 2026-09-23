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
          <th>Discord user</th>
          <th>Mains</th>
          <th>Characters</th>
        </tr>
      </thead>
      <tbody>
        {players.map((player) => {
          const mains = player.characters
            .filter((character) => character.isMain)
            .map(
              (character) =>
                `${`${character.firstName} ${character.lastName}`.trim()} (${character.class} ${character.level})`,
            );
          return (
            <tr key={player.id}>
              <td>{player.discordUserId}</td>
              <td>{mains.length > 0 ? mains.join(', ') : '—'}</td>
              <td>{player.characters.length}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
