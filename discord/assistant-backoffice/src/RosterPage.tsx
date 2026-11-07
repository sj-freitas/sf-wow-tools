import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  claimCharacter,
  deleteCharacter,
  fetchAttributes,
  fetchCharacterNoteIds,
  fetchPlayers,
  fetchRanks,
  fetchUnclaimedCharacters,
  refreshPlayerNames,
} from './api';
import { CharacterForm } from './CharacterForm';
import { DiscordName } from './DiscordName';
import { RoleMark } from './RoleMark';
import { InlineSpinner, SkeletonRows, Spinner } from './Loading';
import { subscribeEvents } from './events';
import { characterPath, playerLabel } from './format';
import {
  ROLE_LABELS,
  type Character,
  type Guild,
  type GuildAttribute,
  type Player,
  type Ranks,
  type Role,
  type User,
} from './types';
import { useCurrentUrl, useReturnTo } from './useReturnTo';
import { ClassMark } from './ClassMark';
import {
  BinIcon,
  ChevronIcon,
  ExternalIcon,
  HammerIcon,
  NoteIcon,
  PencilIcon,
  TagIcon,
} from './Icons';
import { ImportProfessionsDrawer } from './professions/ImportProfessionsDrawer';
import { fetchGuildProfessions } from './professions/professionsApi';
import { ProfessionsDrawer } from './professions/ProfessionsDrawer';
import { armoryLinkFor, gameOf, useArmory, useGames } from './game';
import { showToast } from './toast';
import { AttributesBadge } from './AttributesBadge';
import { CharacterAttributesDrawer, ManageAttributesDrawer } from './AttributeDrawers';
import { RowMenu } from './RowMenu';
import { AttributeChip } from './AttributeChip';
import { fuzzyWordsScore } from './fuzzy';
import { searchRoster, type RosterRow } from './rosterSearch';
import { useConfirm } from './useConfirm';
import { characterPagePath, guildPath } from './guildPath';

/** The roster's default order: these ranks first, in this order (a player's highest counts). */
const RANK_ORDER = ['Officer', 'Raider', 'Social'];

/** The columns the roster can be ordered by. */
type SortColumn = 'name' | 'class' | 'roles' | 'level' | 'discord' | 'rank';

interface Props {
  guild: Guild;
  currentUser: User;
}

/** Everyone in the guild sees the roster; Officers manage every character, members their own. */
export function RosterPage({ guild, currentUser }: Props) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  // Characters no one has claimed yet (added from the armory): shown with the players, as Social.
  const [unclaimed, setUnclaimed] = useState<Character[]>([]);
  const [claimingIds, setClaimingIds] = useState<Set<string>>(new Set());
  const [ranks, setRanks] = useState<Ranks>({});
  // The table's order: a column, A→Z or Z→A (`desc`). Rank (Officers first) unless changed.
  const [sort, setSort] = useState<{ by: SortColumn; desc: boolean }>({ by: 'rank', desc: false });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const here = useCurrentUrl();

  const load = useCallback(() => {
    Promise.all([
      fetchPlayers(guild.id),
      // Optional: without them the roster still shows everyone who has a player.
      fetchUnclaimedCharacters(guild.id).catch((): Character[] => []),
    ])
      .then(([loaded, noOnes]) => {
        setPlayers(loaded);
        setUnclaimed(noOnes);
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
  // Officers: "Import from armory", when the guild's version has an armory and it is set up.
  const armory = Boolean(useArmory() && gameOf(games, guild.gameVersion)?.armoryNamespace);
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
  // The role pills: `?role=TANK&role=HEALER`, characters with any of them.
  const toggleRole = (role: Role) => {
    const current = params.getAll('role');
    const next = new URLSearchParams(params);
    next.delete('role');
    for (const value of current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role]) {
      next.append('role', value);
    }
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete('q');
    next.delete('attr');
    next.delete('role');
    setParams(next, { replace: true });
  };
  const [tagging, setTagging] = useState<{ id: string; name: string } | null>(null);
  // Professions (addon export): one character's, or the import panel.
  const [viewingProfessions, setViewingProfessions] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [importingProfessions, setImportingProfessions] = useState(false);
  const loadAttributes = useCallback(() => {
    fetchAttributes(guild.id)
      .then(setAttributes)
      .catch(() => setAttributes([]));
  }, [guild.id]);
  useEffect(loadAttributes, [loadAttributes]);
  useEffect(() => subscribeEvents('characters', loadAttributes), [loadAttributes]);
  const attributesOf = (characterId: string) =>
    attributes.filter((attribute) => attribute.characterIds.includes(characterId));

  // Each character's professions and what it can craft (the addon's imports), for the search:
  // "blacksmith" or "copper rod" finds them. The recipe names also say how many recipes match.
  const [professionNames, setProfessionNames] = useState<Map<string, string[]>>(new Map());
  const [recipeNames, setRecipeNames] = useState<string[]>([]);
  const loadProfessions = useCallback(() => {
    fetchGuildProfessions(guild.id)
      .then(({ characters, recipes }) => {
        const names = new Map(characters.map((c) => [c.id, c.professions.map((p) => p.name)]));
        for (const recipe of recipes) {
          if (!recipe.name) continue;
          for (const id of recipe.crafterIds) names.get(id)?.push(recipe.name);
        }
        setProfessionNames(names);
        setRecipeNames([...new Set(recipes.flatMap((r) => (r.name ? [r.name] : [])))]);
      })
      .catch(() => {
        setProfessionNames(new Map());
        setRecipeNames([]);
      });
  }, [guild.id]);
  useEffect(loadProfessions, [loadProfessions]);

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

  // A failed action is a note over the page (a banner would push the rows down, the row you
  // acted on with them).
  const failed = (err: unknown) =>
    showToast(err instanceof Error ? err.message : String(err), 8000);
  const run = (action: Promise<unknown>) => {
    action.then(load).catch(failed);
  };

  // Removing a character takes a moment (it waits on the server): the row stays, dimmed and
  // disabled, with a spinner on the button, until it either disappears or the error shows.
  const runClaim = (characterId: string) => {
    setClaimingIds((prev) => new Set(prev).add(characterId));
    claimCharacter(guild.id, characterId)
      .then(() => showToast('It’s yours now'))
      .then(load)
      .catch(failed)
      .finally(() =>
        setClaimingIds((prev) => {
          const next = new Set(prev);
          next.delete(characterId);
          return next;
        }),
      );
  };

  const runDelete = (characterId: string) => {
    setDeletingIds((prev) => new Set(prev).add(characterId));
    deleteCharacter(guild.id, characterId)
      .then(load)
      .catch(failed)
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
  // Officers first, then Raiders, Socials and everyone else; alphabetical within each. A search
  // keeps this order among equally good matches.
  // An unclaimed character has no Discord user, so no roles: it counts as Social.
  const ranksOf = ({ player }: RosterRow): readonly string[] =>
    player ? (ranks[player.discordUserId] ?? []) : ['Social'];
  const rankOrder = (row: RosterRow) => {
    const held = ranksOf(row);
    const at = RANK_ORDER.findIndex((rank) => held.includes(rank));
    return at === -1 ? RANK_ORDER.length : at;
  };
  const rolesOf = (character: Player['characters'][number]) =>
    character.roles.map((role) => ROLE_LABELS[role]).join(', ');
  // A player's ranks as shown: an Officer is also a Raider, so Raider isn't repeated.
  const rankLabel = (row: RosterRow) => {
    const held = ranksOf(row);
    const shown = held.includes('Officer') ? held.filter((rank) => rank !== 'Raider') : held;
    return shown.length > 0 ? shown.join(', ') : undefined;
  };
  type Row = RosterRow;
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const nameOf = ({ character }: Row) => `${character.firstName} ${character.lastName}`.trim();
  // Each column's order; ties go by the character's name.
  const byColumn: Record<SortColumn, (a: Row, b: Row) => number> = {
    name: () => 0,
    class: (a, b) => text(a.character.class, b.character.class),
    roles: (a, b) => text(rolesOf(a.character), rolesOf(b.character)),
    level: (a, b) => a.character.level - b.character.level,
    // Unclaimed characters after everyone's.
    discord: (a, b) =>
      Number(!a.player) - Number(!b.player) ||
      text(a.player ? playerLabel(a.player) : '', b.player ? playerLabel(b.player) : ''),
    rank: (a, b) => rankOrder(a) - rankOrder(b),
  };
  const rows: Row[] = players
    ? [
        ...players.flatMap((player) =>
          player.characters.map((character): Row => ({ player, character })),
        ),
        ...unclaimed.map((character): Row => ({ player: null, character })),
      ].sort((a, b) => {
        const order = byColumn[sort.by](a, b) || text(nameOf(a), nameOf(b));
        return sort.desc ? -order : order;
      })
    : [];
  // A column's header: its name and a chevron; a click sorts by it, again the other way round.
  const sortHeader = (by: SortColumn, label: string) => {
    const active = sort.by === by;
    return (
      <th aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}>
        <button
          type="button"
          className={active ? 'sort-header sort-header-active' : 'sort-header'}
          onClick={() => setSort({ by, desc: active ? !sort.desc : false })}
        >
          {label}
          <span
            className={sort.desc && active ? 'sort-chevron sort-chevron-up' : 'sort-chevron'}
            aria-hidden="true"
          >
            <ChevronIcon />
          </span>
        </button>
      </th>
    );
  };
  // Search and attribute filter, kept in the address (`?q=warr&attr=Switcher`) so a filtered
  // roster can be linked to.
  const picked = params.getAll('attr').filter((name) => attributes.some((a) => a.name === name));
  const withPicked = rows.filter(({ character }) =>
    picked.every((name) => attributesOf(character.id).some((a) => a.name === name)),
  );
  const pickedRoles = params
    .getAll('role')
    .filter((role): role is Role => Object.hasOwn(ROLE_LABELS, role));
  const withRoles =
    pickedRoles.length === 0
      ? withPicked
      : withPicked.filter(({ character }) =>
          character.roles.some((role) => pickedRoles.includes(role)),
        );
  const shown = searchRoster(
    withRoles,
    query,
    attributesOf,
    ranksOf,
    (characterId) => professionNames.get(characterId) ?? [],
  );
  const filtering = query.trim() !== '' || picked.length > 0 || pickedRoles.length > 0;
  const matchingRecipes = query.trim()
    ? recipeNames.filter((name) => fuzzyWordsScore(query, [name]) !== null).length
    : 0;
  const missingNames =
    players?.some((player) => !player.discordUsername && !player.discordDisplayName) ?? false;
  // "Open in armory": the character's page there, or a passing note when the version's armory
  // doesn't exist yet (`armoryPending` in the API's game config).
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
  // An unclaimed character is Officers' to edit; members claim it first.
  const canEditRow = (player: Player | null) =>
    guild.isOfficer || player?.discordUserId === currentUser.discordId;
  const askClaim = (character: Character, name: string) =>
    void confirm({
      title: `Claim ${name}?`,
      message:
        'It becomes your character, in every guild it is in. Claim only the ones you play: an Officer can give it to someone else if it was wrong.',
      confirmLabel: 'Claim',
    }).then((ok) => ok && runClaim(character.id));
  // Who plays it, or for an unclaimed character a Claim button (anyone in the guild).
  const playerCell = (player: Player | null, character: Character, name: string) =>
    player ? (
      <DiscordName label={playerLabel(player)} id={player.discordUserId} />
    ) : (
      <span className="unclaimed-player">
        <span className="muted">Unclaimed</span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={claimingIds.has(character.id)}
          title="Say it’s yours"
          onClick={() => askClaim(character, name)}
        >
          {claimingIds.has(character.id) ? 'Claiming…' : 'Claim'}
        </button>
      </span>
    );
  const rowMenu = (
    player: Player | null,
    character: Player['characters'][number],
    name: string,
  ) => (
    <RowMenu
      label={`Actions for ${name}`}
      busy={deletingIds.has(character.id) ? <InlineSpinner label="" /> : undefined}
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
        // Everyone: the character's armory page (or, until the version's armory exists, a note
        // that it doesn't yet).
        armoryItem(character),
        {
          label: (
            <>
              <HammerIcon /> Professions
            </>
          ),
          onSelect: () => setViewingProfessions({ id: character.id, name }),
        },
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
                    {notedIds.has(character.id) ? ' Officer note' : ' Write an officer note'}
                    {notedIds.has(character.id) && (
                      <span className="row-menu-dot" aria-label="(written)" />
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
                    message: player
                      ? 'The character itself is kept (its other guilds, its bio), so it can be added back later.'
                      : 'No one has claimed it: on no other roster, it is deleted, and its name can be added again later.',
                    confirmLabel: 'Remove',
                    danger: true,
                  }).then((ok) => ok && runDelete(character.id)),
              },
            ]
          : []),
      ]}
    />
  );
  const characterLink = (character: Player['characters'][number], name: string) => (
    <Link
      className="character-link"
      to={characterPagePath(guild, characterPath(character))}
      state={{ from: here }}
    >
      {name}
    </Link>
  );
  const attributesBadge = (characterId: string, name: string) => (
    <AttributesBadge
      attributes={attributesOf(characterId)}
      onEdit={guild.isOfficer ? () => setTagging({ id: characterId, name }) : undefined}
    />
  );

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
      {viewingProfessions && (
        <ProfessionsDrawer
          guildId={guild.id}
          character={viewingProfessions}
          onClose={() => setViewingProfessions(null)}
        />
      )}
      {importingProfessions && (
        <ImportProfessionsDrawer
          guildId={guild.id}
          onClose={() => {
            setImportingProfessions(false);
            loadProfessions();
          }}
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
          {/* The professions addon's file: all of the user's characters in the guild at once. */}
          <button type="button" className="btn" onClick={() => setImportingProfessions(true)}>
            <HammerIcon /> Import professions
          </button>
          {guild.isOfficer && (
            <button type="button" className="btn" onClick={() => setManaging(true)}>
              Attributes
            </button>
          )}
          {guild.isOfficer && armory && (
            <Link
              className="btn"
              to={guildPath(guild, 'roster/armory')}
              state={{ from: here }}
              title="The guild's members in Blizzard's armory: add the ones not on the roster"
            >
              Import from armory
            </Link>
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

      {!players ? (
        <div className="table-wrap">
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
                placeholder="Search name, class, role, profession, attribute, Discord name or ID…"
                aria-label="Search the roster"
              />
            </div>
            <div className="roster-attribute-filter">
              <span className="roster-pill-group" role="group" aria-label="Filter by role">
                {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={pickedRoles.includes(role)}
                    className={
                      pickedRoles.includes(role)
                        ? 'attribute-toggle attribute-toggle-on'
                        : 'attribute-toggle'
                    }
                    onClick={() => toggleRole(role)}
                  >
                    <span className="role-chip">
                      <RoleMark gameVersion={guild.gameVersion} role={role} label="" />
                      {ROLE_LABELS[role]}
                    </span>
                  </button>
                ))}
              </span>
              {attributes.length > 0 && (
                <span className="roster-pill-group" role="group" aria-label="Filter by attribute">
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
                </span>
              )}
            </div>
            {/* Always there, one line: typing a search never moves the list. */}
            <div className="roster-filter-summary">
              <span className="muted">
                {filtering
                  ? `${shown.length} of ${rows.length} characters`
                  : `${rows.length} character${rows.length === 1 ? '' : 's'}`}
              </span>
              {matchingRecipes > 0 && (
                <Link
                  to={`${guildPath(guild, 'professions')}?q=${encodeURIComponent(query)}`}
                  title="See who can craft them on Professions"
                >
                  {matchingRecipes} recipe{matchingRecipes === 1 ? '' : 's'} match: see who can
                  craft {matchingRecipes === 1 ? 'it' : 'them'} →
                </Link>
              )}
              {filtering && (
                <button type="button" className="btn btn-sm" onClick={clearFilters}>
                  Clear
                </button>
              )}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="empty">No characters match.</p>
          ) : (
            <>
              {/* Phones: one compact card per character instead of the table. */}
              <ul className="roster-list">
                {shown.map(({ player, character }) => {
                  const name = `${character.firstName} ${character.lastName}`.trim();
                  const rank = rankLabel({ player, character });
                  return (
                    <li
                      key={character.id}
                      className={
                        deletingIds.has(character.id) ? 'roster-item row-pending' : 'roster-item'
                      }
                    >
                      <div className="roster-item-head">
                        <ClassMark gameVersion={guild.gameVersion} className={character.class} />
                        <span className="roster-item-name">
                          {characterLink(character, name)}
                          {attributesBadge(character.id, name)}
                        </span>
                        {rowMenu(player, character, name)}
                      </div>
                      <div className="roster-item-meta">
                        {[character.class, rolesOf(character), `Lv ${character.level}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <div className="roster-item-meta">
                        {playerCell(player, character, name)}
                        {rank && ` · ${rank}`}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="table-wrap roster-table">
                <table>
                  {/* Fixed widths (see .roster-table): what is in a row never resizes a column. */}
                  <colgroup>
                    <col className="col-name" />
                    <col className="col-class" />
                    <col className="col-roles" />
                    <col className="col-level" />
                    <col className="col-discord" />
                    <col className="col-rank" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      {sortHeader('name', 'Character')}
                      {sortHeader('class', 'Class')}
                      {sortHeader('roles', 'Roles')}
                      {sortHeader('level', 'Level')}
                      {sortHeader('discord', 'Discord user')}
                      {sortHeader('rank', 'Rank')}
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
                              {characterLink(character, name)}
                              {attributesBadge(character.id, name)}
                            </td>
                            <td data-label="Class" className="cell-compact">
                              <ClassMark
                                gameVersion={guild.gameVersion}
                                className={character.class}
                              />
                              {character.class}
                            </td>
                            {/* Icons, the role on hover: several roles as words widened the table. */}
                            <td data-label="Roles" className="cell-compact cell-roles">
                              <span className="role-marks">
                                {character.roles.map((role) => (
                                  <RoleMark
                                    key={role}
                                    gameVersion={guild.gameVersion}
                                    role={role}
                                    label={ROLE_LABELS[role]}
                                    tip
                                  />
                                ))}
                              </span>
                            </td>
                            <td data-label="Level" className="cell-compact cell-level">
                              {character.level}
                            </td>
                            <td data-label="Discord user" className="cell-detail">
                              {playerCell(player, character, name)}
                            </td>
                            <td data-label="Rank" className="cell-detail">
                              {rankLabel({ player, character }) ?? '—'}
                            </td>
                            <td className="cell-actions">{rowMenu(player, character, name)}</td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
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
  const [unclaimed, setUnclaimed] = useState<Character[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!characterId) return;
    Promise.all([fetchPlayers(guild.id), fetchUnclaimedCharacters(guild.id)])
      .then(([loaded, noOnes]) => {
        setPlayers(loaded);
        setUnclaimed(noOnes);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, characterId]);

  const found: RosterRow | undefined = characterId
    ? [
        ...(players ?? []).flatMap((player) =>
          player.characters.map((character): RosterRow => ({ player, character })),
        ),
        ...unclaimed.map((character): RosterRow => ({ player: null, character })),
      ].find((row) => row.character.id === characterId)
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
    const mayEdit = guild.isOfficer || found.player?.discordUserId === currentUser.discordId;
    if (!mayEdit) {
      return (
        <p className="empty">
          {found.player
            ? 'You can only edit your own characters.'
            : 'No one has claimed this character yet: claim it on the roster if it’s yours.'}
        </p>
      );
    }
    return (
      <CharacterForm
        guild={guild}
        currentUser={currentUser}
        editing={{
          character: found.character,
          // Unclaimed: no player yet ('').
          playerLabel: found.player ? playerLabel(found.player) : 'Unclaimed',
          playerId: found.player?.discordUserId ?? '',
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
