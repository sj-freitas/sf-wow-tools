import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  deleteCharacter,
  fetchAttributes,
  fetchCharacterNoteIds,
  fetchPlayers,
  fetchRanks,
  refreshPlayerNames,
} from './api';
import { CharacterForm } from './CharacterForm';
import { DiscordName } from './DiscordName';
import { InlineSpinner, SkeletonRows, Spinner } from './Loading';
import { subscribeEvents } from './events';
import { characterPath, playerLabel } from './format';
import {
  ROLE_LABELS,
  type Guild,
  type GuildAttribute,
  type Player,
  type Ranks,
  type User,
} from './types';
import { useCurrentUrl, useReturnTo } from './useReturnTo';
import { ClassMark } from './ClassMark';
import { BinIcon, ExternalIcon, NoteIcon, PencilIcon, TagIcon } from './Icons';
import { armoryLinkFor, gameOf, useGames } from './game';
import { showToast } from './toast';
import { AttributesBadge } from './AttributesBadge';
import { CharacterAttributesDrawer, ManageAttributesDrawer } from './AttributeDrawers';
import { RowMenu } from './RowMenu';
import { AttributeChip } from './AttributeChip';
import { searchRoster } from './rosterSearch';
import { useConfirm } from './useConfirm';
import { characterPagePath, guildPath } from './guildPath';

interface Props {
  guild: Guild;
  currentUser: User;
}

/** Everyone in the guild sees the roster; Officers manage every character, members their own. */
export function RosterPage({ guild, currentUser }: Props) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [ranks, setRanks] = useState<Ranks>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const here = useCurrentUrl();

  const load = useCallback(() => {
    fetchPlayers(guild.id)
      .then((loaded) => {
        setPlayers(loaded);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [guild.id]);

  // Ranks are read live from Discord roles and are optional decoration.
  const loadRanks = useCallback(() => {
    fetchRanks(guild.id)
      .then(setRanks)
      .catch(() => setRanks({}));
  }, [guild.id]);

  // The guild's attributes (labels like "Switcher"), shown under names; Officers edit them.
  const [attributes, setAttributes] = useState<GuildAttribute[]>([]);
  const [managing, setManaging] = useState(false);
  const { confirm, dialog } = useConfirm();
  const games = useGames();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };
  const toggleAttribute = (name: string) => {
    const current = params.getAll('attr');
    const next = new URLSearchParams(params);
    next.delete('attr');
    for (const value of current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name]) {
      next.append('attr', value);
    }
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete('q');
    next.delete('attr');
    setParams(next, { replace: true });
  };
  const [tagging, setTagging] = useState<{ id: string; name: string } | null>(null);
  const loadAttributes = useCallback(() => {
    fetchAttributes(guild.id)
      .then(setAttributes)
      .catch(() => setAttributes([]));
  }, [guild.id]);
  useEffect(loadAttributes, [loadAttributes]);
  useEffect(() => subscribeEvents('characters', loadAttributes), [loadAttributes]);
  const attributesOf = (characterId: string) =>
    attributes.filter((attribute) => attribute.characterIds.includes(characterId));

  // Officers: which characters have an Officer note, to mark their note button.
  const [notedIds, setNotedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!guild.isOfficer) return;
    fetchCharacterNoteIds(guild.id)
      .then(({ characterIds }) => setNotedIds(new Set(characterIds)))
      .catch(() => setNotedIds(new Set()));
  }, [guild.id, guild.isOfficer]);

  useEffect(load, [load]);
  useEffect(loadRanks, [loadRanks]);
  // Discord roles change outside the app: look again every minute while the page is open.
  useEffect(() => {
    const timer = setInterval(loadRanks, 60_000);
    return () => clearInterval(timer);
  }, [loadRanks]);
  useEffect(() => subscribeEvents('characters', load), [load]);
  useEffect(
    () =>
      subscribeEvents('guild', () => {
        load();
        loadRanks();
      }),
    [load, loadRanks],
  );

  const run = (action: Promise<unknown>) => {
    setActionError(null);
    action
      .then(load)
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
  };

  // Removing a character takes a moment (it waits on the server): the row stays, dimmed and
  // disabled, with a spinner on the button, until it either disappears or the error shows.
  const runDelete = (characterId: string) => {
    setActionError(null);
    setDeletingIds((prev) => new Set(prev).add(characterId));
    deleteCharacter(guild.id, characterId)
      .then(load)
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
      .finally(() =>
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(characterId);
          return next;
        }),
      );
  };

  if (loadError && !players) {
    return (
      <div className="status status-error">
        <p>Could not load players: {loadError}</p>
        <button type="button" className="btn" onClick={load}>
          Retry
        </button>
      </div>
    );
  }
  const rows = players
    ? players.flatMap((player) => player.characters.map((character) => ({ player, character })))
    : [];
  // Search and attribute filter, kept in the address (`?q=warr&attr=Switcher`) so a filtered
  // roster can be linked to.
  const picked = params.getAll('attr').filter((name) => attributes.some((a) => a.name === name));
  const withPicked = rows.filter(({ character }) =>
    picked.every((name) => attributesOf(character.id).some((a) => a.name === name)),
  );
  const shown = searchRoster(
    withPicked,
    query,
    attributesOf,
    (discordUserId) => ranks[discordUserId] ?? [],
  );
  const filtering = query.trim() !== '' || picked.length > 0;
  const missingNames =
    players?.some((player) => !player.discordUsername && !player.discordDisplayName) ?? false;
  // "Open in armory": the character's page there, or a passing note while the version's armory
  // doesn't exist yet (TODO(armory) in src/game/forever/config.ts, and TODO.md).
  const game = gameOf(games, guild.gameVersion);
  const armoryItem = (character: Player['characters'][number]) => {
    const href = armoryLinkFor(game, {
      name: character.firstName,
      lastName: character.lastName,
      region: guild.region,
      server: guild.realm,
    });
    const label = (
      <>
        <ExternalIcon /> Open in armory
      </>
    );
    return href
      ? { label, href }
      : {
          label,
          onSelect: () => showToast(`This feature doesn’t exist on ${guild.gameVersion} yet`),
        };
  };
  const canEditRow = (player: Player) =>
    guild.isOfficer || player.discordUserId === currentUser.discordId;

  return (
    <div className="tasks">
      {dialog}
      {managing && (
        <ManageAttributesDrawer
          guild={guild}
          attributes={attributes}
          onClose={() => setManaging(false)}
          onChanged={loadAttributes}
        />
      )}
      {tagging && (
        <CharacterAttributesDrawer
          guild={guild}
          character={tagging}
          attributes={attributes}
          onClose={() => setTagging(null)}
          onChanged={loadAttributes}
          onManage={() => {
            setTagging(null);
            setManaging(true);
          }}
        />
      )}
      <div className="tasks-head">
        <div>
          <h3>Roster</h3>
        </div>
        <div className="settings-actions">
          {guild.isOfficer && (
            <button type="button" className="btn" onClick={() => setManaging(true)}>
              Attributes
            </button>
          )}
          {guild.isOfficer && missingNames && (
            <button
              type="button"
              className="btn"
              title="Look up the Discord usernames of players we only know by ID"
              onClick={() => run(refreshPlayerNames(guild.id))}
            >
              Refresh names
            </button>
          )}
          <Link
            className="btn btn-primary"
            to={guildPath(guild, 'roster/create')}
            state={{ from: here }}
          >
            {guild.isOfficer ? '+ Add character' : '+ Add my character'}
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="banner banner-error" role="alert">
          <span>{actionError}</span>
          <button type="button" className="btn btn-sm" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {!players ? (
        <div className="table-wrap roster-table">
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th>Class</th>
                <th>Roles</th>
                <th>Level</th>
                <th>Discord user</th>
                <th>Rank</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <SkeletonRows columns={7} />
            </tbody>
          </table>
        </div>
      ) : rows.length === 0 ? (
        <p className="empty">No characters registered yet.</p>
      ) : (
        <>
          <div className="roster-filters">
            <div className="search-field">
              <input
                className="post-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, class, role, attribute, Discord name or ID…"
                aria-label="Search the roster"
              />
            </div>
            {attributes.length > 0 && (
              <div
                className="roster-attribute-filter"
                role="group"
                aria-label="Filter by attribute"
              >
                {attributes.map((attribute) => (
                  <button
                    key={attribute.id}
                    type="button"
                    aria-pressed={picked.includes(attribute.name)}
                    className={
                      picked.includes(attribute.name)
                        ? 'attribute-toggle attribute-toggle-on'
                        : 'attribute-toggle'
                    }
                    onClick={() => toggleAttribute(attribute.name)}
                  >
                    <AttributeChip name={attribute.name} color={attribute.color} />
                  </button>
                ))}
              </div>
            )}
            {filtering && (
              <div className="roster-filter-summary">
                <span className="muted">
                  {shown.length} of {rows.length} characters
                </span>
                <button type="button" className="btn btn-sm" onClick={clearFilters}>
                  Clear
                </button>
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="empty">No characters match.</p>
          ) : (
            <div className="table-wrap roster-table">
              <table>
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Class</th>
                    <th>Roles</th>
                    <th>Level</th>
                    <th>Discord user</th>
                    <th>Rank</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ player, character }) => {
                    const deleting = deletingIds.has(character.id);
                    const name = `${character.firstName} ${character.lastName}`.trim();
                    return (
                      <Fragment key={character.id}>
                        <tr className={deleting ? 'row-pending' : undefined}>
                          <td data-label="Character" className="cell-name">
                            <Link
                              className="character-link"
                              to={characterPagePath(guild, characterPath(character))}
                              state={{ from: here }}
                            >
                              {name}
                            </Link>
                            {character.isMain && (
                              <span className="badge badge-main main-pill">Main</span>
                            )}
                            <AttributesBadge
                              attributes={attributesOf(character.id)}
                              onEdit={
                                guild.isOfficer
                                  ? () => setTagging({ id: character.id, name })
                                  : undefined
                              }
                            />
                          </td>
                          <td data-label="Class" className="cell-compact">
                            <ClassMark
                              gameVersion={guild.gameVersion}
                              className={character.class}
                            />
                            {character.class}
                          </td>
                          <td data-label="Roles" className="cell-compact">
                            {character.roles.map((role) => ROLE_LABELS[role]).join(', ')}
                          </td>
                          <td data-label="Level" className="cell-compact cell-level">
                            {character.level}
                          </td>
                          <td data-label="Discord user" className="cell-detail">
                            <DiscordName label={playerLabel(player)} id={player.discordUserId} />
                          </td>
                          <td data-label="Rank" className="cell-detail">
                            {ranks[player.discordUserId]?.join(', ') ?? '—'}
                          </td>
                          <td className="cell-actions">
                            <RowMenu
                              label={`Actions for ${name}`}
                              busy={deleting ? <InlineSpinner label="" /> : undefined}
                              items={[
                                ...(canEditRow(player)
                                  ? [
                                      {
                                        label: (
                                          <>
                                            <PencilIcon /> Edit
                                          </>
                                        ),
                                        to: guildPath(guild, `roster/edit/${character.id}`),
                                        state: { from: here },
                                      },
                                    ]
                                  : []),
                                // Everyone: the character's armory page (or, until the version's
                                // armory exists, a note that it doesn't yet).
                                armoryItem(character),
                                ...(guild.isOfficer
                                  ? [
                                      {
                                        label: (
                                          <>
                                            <TagIcon /> Attributes
                                          </>
                                        ),
                                        onSelect: () => setTagging({ id: character.id, name }),
                                      },
                                      {
                                        label: (
                                          <>
                                            <NoteIcon />
                                            {notedIds.has(character.id)
                                              ? ' Officer note'
                                              : ' Write an officer note'}
                                            {notedIds.has(character.id) && (
                                              <span
                                                className="row-menu-dot"
                                                aria-label="(written)"
                                              />
                                            )}
                                          </>
                                        ),
                                        to: guildPath(guild, `roster/notes/${character.id}`),
                                        state: { from: here },
                                      },
                                    ]
                                  : []),
                                ...(canEditRow(player)
                                  ? [
                                      {
                                        label: (
                                          <>
                                            <BinIcon /> Remove from roster
                                          </>
                                        ),
                                        danger: true,
                                        onSelect: () =>
                                          void confirm({
                                            title: `Remove ${name} from the roster?`,
                                            message:
                                              'The character itself is kept (its other guilds, its bio), so it can be added back later.',
                                            confirmLabel: 'Remove',
                                            danger: true,
                                          }).then((ok) => ok && runDelete(character.id)),
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** `/roster/create` and `/roster/edit/:characterId`: the character form on its own page. */
export function CharacterEditorPage({ guild, currentUser }: Props) {
  const { characterId } = useParams();
  const navigate = useNavigate();
  const back = useReturnTo(guildPath(guild, 'roster'));
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!characterId) return;
    fetchPlayers(guild.id)
      .then(setPlayers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, characterId]);

  const found = characterId
    ? players
        ?.flatMap((player) => player.characters.map((character) => ({ player, character })))
        .find((row) => row.character.id === characterId)
    : undefined;

  const body = () => {
    if (!characterId) {
      return (
        <CharacterForm
          guild={guild}
          currentUser={currentUser}
          onSaved={() => navigate(back)}
          onCancel={() => navigate(back)}
        />
      );
    }
    if (error) return <p className="status-error">{error}</p>;
    if (!players) return <Spinner />;
    if (!found) return <p className="empty">That character was not found in this guild.</p>;
    const mayEdit = guild.isOfficer || found.player.discordUserId === currentUser.discordId;
    if (!mayEdit) return <p className="empty">You can only edit your own characters.</p>;
    return (
      <CharacterForm
        guild={guild}
        currentUser={currentUser}
        editing={{
          character: found.character,
          playerLabel: playerLabel(found.player),
          playerId: found.player.discordUserId,
        }}
        onSaved={() => navigate(back)}
        onCancel={() => navigate(back)}
      />
    );
  };

  return (
    <div className="tasks">
      <Link className="back-link" to={back}>
        ← Roster
      </Link>
      {body()}
    </div>
  );
}
