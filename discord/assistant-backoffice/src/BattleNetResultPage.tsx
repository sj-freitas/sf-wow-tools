import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { request } from './api';
import { Spinner } from './Loading';

/** What "Verify with Battle.net" found (the API's BattleNetResultDto). */
interface BattleNetResult {
  character: { name: string; pagePath: string };
  server: string;
  battleTag: string | null;
  characters: {
    name: string;
    realm: string;
    level: number | null;
    class: string | null;
    race: string | null;
    faction: string | null;
  }[];
  found: boolean;
  error: string | null;
}

/**
 * `/battlenet/:id`: where Battle.net's login comes back to. Shows the account's characters on the
 * server it read and whether the character is one of them. A preview: nothing is changed yet;
 * at WoW Forever's launch this will verify the character.
 */
export function BattleNetResultPage() {
  const { id = '' } = useParams();
  const [result, setResult] = useState<BattleNetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<BattleNetResult>('GET', `/api/battlenet/results/${encodeURIComponent(id)}`)
      .then(setResult)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (error) return <p className="status-error card-body">{error}</p>;
  if (!result) return <Spinner />;
  return (
    <div className="tasks">
      <Link className="back-link" to={result.character.pagePath}>
        ← {result.character.name}
      </Link>
      <h2>Battle.net check: {result.character.name}</h2>
      {result.error ? (
        <p className="status-error">{result.error}</p>
      ) : (
        <>
          <p className="muted">
            {result.battleTag
              ? `Battle.net account ${result.battleTag}`
              : 'Your Battle.net account'}{' '}
            has {result.characters.length} character{result.characters.length === 1 ? '' : 's'} on{' '}
            {result.server}.
          </p>
          {result.found ? (
            <p>✅ {result.character.name} is one of them.</p>
          ) : (
            <p>❌ {result.character.name} isn’t one of them.</p>
          )}
          {result.characters.length > 0 && (
            <ul className="own-characters">
              {result.characters.map((character) => (
                <li key={`${character.realm}/${character.name}`} className="own-character">
                  <div className="own-character-main">
                    <strong>{character.name}</strong>
                    <div className="muted">
                      {[
                        character.level !== null ? `Level ${character.level}` : null,
                        character.race,
                        character.class,
                        character.faction,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="muted">
        This is a preview: nothing was changed. When WoW Forever launches, this check will read
        Forever’s characters and mark the character as verified.
      </p>
    </div>
  );
}
