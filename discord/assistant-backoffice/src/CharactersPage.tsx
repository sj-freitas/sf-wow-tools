import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchOwnCharacters } from './api';
import { ClassMark } from './ClassMark';
import { characterPagePath } from './guildPath';
import { SkeletonLines } from './Loading';
import type { OwnCharacters } from './types';

/**
 * `/<version>/<region>/<server>/characters`: your characters on that server, by name, each
 * with its page, its guilds and (on RP servers) its bio.
 */
export function CharactersPage() {
  const { version = '', region = '', realm = '' } = useParams();
  const [data, setData] = useState<OwnCharacters | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetchOwnCharacters(version, region, realm)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [version, region, realm]);

  const server = { gameVersion: version, region, realm };

  return (
    <div className="tasks">
      <div className="tasks-head">
        <div>
          <h2>Your characters</h2>
          <span className="muted">
            {realm} · {version} · {region.toUpperCase()}
          </span>
        </div>
      </div>
      {error ? (
        <p className="status-error">{error}</p>
      ) : !data ? (
        <SkeletonLines count={4} />
      ) : data.characters.length === 0 ? (
        <p className="empty">
          You have no characters on this server yet. Add them from your guild’s Roster.
        </p>
      ) : (
        <ul className="own-characters">
          {data.characters.map((character) => (
            <li key={character.characterId} className="own-character">
              <div className="own-character-main">
                <Link
                  className="own-character-name"
                  to={characterPagePath(server, character.namePath)}
                >
                  <ClassMark gameVersion={version} className={character.class} />
                  {character.name}
                </Link>
                <div className="muted">
                  {character.class} · {character.race} · Level {character.level}
                  {character.roles.length > 0 && ` · ${character.roles.join(', ')}`}
                </div>
                {character.guilds.length > 0 && (
                  <div className="muted">
                    {character.guilds.map((guild, index) => (
                      <span key={guild.path}>
                        {index > 0 && ', '}
                        <Link to={`/${guild.path}`}>{guild.name}</Link>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {data.bioSupported && (
                <Link
                  className="btn btn-sm"
                  to={characterPagePath(server, character.namePath, 'bio')}
                >
                  {character.hasBio ? 'Edit bio' : 'Write a bio'}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
