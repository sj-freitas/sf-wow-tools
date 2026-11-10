import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchAllOwnCharacters, fetchOwnCharacters } from './api';
import { ClassMark } from './ClassMark';
import { characterPagePath } from './guildPath';
import { SkeletonLines } from './Loading';
import type { OwnCharacter, OwnCharacters, OwnServer } from './types';

type Server = { gameVersion: string; region: string; realm: string };

/** "RP · Forever · EU". */
const serverLabel = (server: Server): string =>
  `${server.realm} · ${server.gameVersion} · ${server.region.toUpperCase()}`;

/** The per-server page's address: `/forever/eu/rp/characters`. */
const serverPath = (server: Server): string =>
  `/${[server.gameVersion, server.region, server.realm].map((s) => s.toLowerCase()).join('/')}/characters`;

/**
 * One of your characters: its page, what it is, the guilds it's in (each linking to the guild),
 * its bio (on RP servers) and Verify with Battle.net, or that it's verified.
 */
function OwnCharacterItem({
  character,
  server,
  bioSupported,
}: {
  character: OwnCharacter;
  server: Server;
  bioSupported: boolean;
}) {
  return (
    <li className="own-character">
      <div className="own-character-main">
        <Link className="own-character-name" to={characterPagePath(server, character.namePath)}>
          <ClassMark gameVersion={server.gameVersion} className={character.class} />
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
      <div className="own-character-actions">
        {bioSupported && (
          <Link className="btn btn-sm" to={characterPagePath(server, character.namePath, 'bio')}>
            {character.hasBio ? 'Edit bio' : 'Write a bio'}
          </Link>
        )}
        {character.verified ? (
          <span
            className="badge badge-main"
            title="You proved on Battle.net that it is yours: only you can change it."
          >
            Battle.net verified
          </span>
        ) : (
          // A full page load: the API sends the browser to Battle.net, and back to the result.
          <a
            className="btn btn-sm"
            href={`/api/battlenet/login?characterId=${encodeURIComponent(character.characterId)}`}
            title="Log in on Battle.net to show this is your character"
          >
            Verify with Battle.net
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * `/characters` (your menu, Characters): all your characters, on every server, by server; each
 * with its page, its guilds, its bio and Verify with Battle.net.
 */
export function AllCharactersPage() {
  const [servers, setServers] = useState<OwnServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllOwnCharacters()
      .then(setServers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="tasks">
      <div className="tasks-head">
        <h2>Your characters</h2>
      </div>
      {error ? (
        <p className="status-error">{error}</p>
      ) : !servers ? (
        <SkeletonLines count={4} />
      ) : servers.length === 0 ? (
        <p className="empty">You have no characters yet. Add them from your guild’s Roster.</p>
      ) : (
        servers.map((server) => (
          <section key={serverPath(server)} className="own-server">
            <h3 className="own-server-name">
              <Link to={serverPath(server)}>{serverLabel(server)}</Link>
            </h3>
            <ul className="own-characters">
              {server.characters.map((character) => (
                <OwnCharacterItem
                  key={character.characterId}
                  character={character}
                  server={server}
                  bioSupported={server.bioSupported}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/**
 * `/<version>/<region>/<server>/characters`: your characters on that server, by name, each
 * with its page, its guilds, (on RP servers) its bio and Verify with Battle.net.
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
            {serverLabel(server)} · <Link to="/characters">All your characters</Link>
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
            <OwnCharacterItem
              key={character.characterId}
              character={character}
              server={server}
              bioSupported={data.bioSupported}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
