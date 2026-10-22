import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fuzzyWordsScore } from '../fuzzy';
import { SkeletonLines } from '../Loading';
import { timeAgo } from '../time';
import { ADDON_URL } from './ImportProfessionsDrawer';
import { ChevronIcon } from '../Icons';
import { useConfirm } from '../useConfirm';
import {
  dropProfession,
  fetchCharacterProfessions,
  professionSections,
  SECONDARY_PROFESSIONS,
  type Profession,
} from './professionsApi';
import './professions.css';

/** Wowhead's small icon for a spell or item. */
const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`;

/**
 * What a character can craft, on its page: its professions, collapsed until opened (or while
 * searching), each with its recipes linking to Wowhead, and a search over them.
 */
export function CharacterProfessions({
  characterId,
  importGuilds,
  canDrop = false,
}: {
  characterId: string;
  /** Its own player: the guilds to import professions in (a link to each one's import panel). */
  importGuilds?: { name: string; path: string }[];
  /** Its player, or an Officer of a guild it is in: "Drop this profession" on main professions. */
  canDrop?: boolean;
}) {
  const { confirm, dialog } = useConfirm();
  const [dropError, setDropError] = useState<string | null>(null);
  const [professions, setProfessions] = useState<Profession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Collapsed, or open while searching; a click flips one from that until the search starts or ends.
  const searching = query.trim() !== '';
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  useEffect(() => setToggled(new Set()), [searching]);

  const load = useCallback(() => {
    setProfessions(null);
    fetchCharacterProfessions(characterId)
      .then(setProfessions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [characterId]);
  useEffect(load, [load]);

  // Unlearned in game: dropped here too, after asking. Its recipes go with it.
  const drop = (name: string, recipes: number) =>
    void confirm({
      title: `Drop ${name}?`,
      message: `This character's ${name} and its ${recipes} recipe${recipes === 1 ? '' : 's'} are removed from Guild Assistant. Importing them again from the addon brings them back.`,
      confirmLabel: 'Drop it',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      setDropError(null);
      dropProfession(characterId, name)
        .then(load)
        .catch((err: unknown) => setDropError(err instanceof Error ? err.message : String(err)));
    });

  const shown = useMemo(
    () =>
      (professions ?? [])
        .map((profession) => ({
          ...profession,
          recipes: searching
            ? profession.recipes.filter(
                (recipe) =>
                  fuzzyWordsScore(query, [recipe.name ?? String(recipe.id), profession.name]) !==
                  null,
              )
            : profession.recipes,
        }))
        .filter((profession) => !searching || profession.recipes.length > 0),
    [professions, query, searching],
  );

  // "Import professions" in the character's guild(s): its Professions page with the panel open.
  const importLinks =
    importGuilds && importGuilds.length > 0 ? (
      <p className="muted">
        Import professions{importGuilds.length > 1 ? ' in ' : ': '}
        {importGuilds.map((guild, index) => (
          <span key={guild.path}>
            {index > 0 && ', '}
            <Link to={`/${guild.path}/professions/import`}>
              {importGuilds.length > 1 ? guild.name : `in ${guild.name}`}
            </Link>
          </span>
        ))}
      </p>
    ) : null;

  if (error) return <p className="status-error">{error}</p>;
  if (!professions) return <SkeletonLines count={4} />;
  if (professions.length === 0) {
    return (
      <p className="empty">
        No professions imported yet. Its player imports them with the{' '}
        <a href={ADDON_URL} target="_blank" rel="noreferrer">
          Guild Assistant Professions addon
        </a>
        .{importLinks && ' '}
        {importLinks}
      </p>
    );
  }
  return (
    <div className="professions">
      {dialog}
      {importLinks}
      {dropError && <p className="status-error">{dropError}</p>}
      <div className="search-field">
        <input
          className="post-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes…"
          aria-label="Search this character's recipes"
        />
      </div>
      {shown.length === 0 ? (
        <p className="empty">No recipes match.</p>
      ) : (
        professionSections(shown, (profession) => profession.name).map((section) => (
          <div key={section.title} className="profession-section">
            <h4 className="profession-section-title">{section.title}</h4>
            {section.items.map((profession) => {
              const open = searching !== toggled.has(profession.name);
              return (
                <section key={profession.name} className="guild-profession">
                  {/* The heading opens and closes it; "Drop this profession" sits on its line,
                    open or not (a button can't hold another, so they are side by side). */}
                  <div className="guild-profession-line">
                    <button
                      type="button"
                      className="guild-profession-head"
                      aria-expanded={open}
                      onClick={() =>
                        setToggled((current) => {
                          const next = new Set(current);
                          if (!next.delete(profession.name)) next.add(profession.name);
                          return next;
                        })
                      }
                    >
                      <span className="guild-profession-chevron" aria-hidden="true">
                        <ChevronIcon />
                      </span>
                      <strong>{profession.name}</strong>
                      <span className="muted">
                        {profession.skill !== null &&
                          `${profession.skill}${profession.maxSkill ? `/${profession.maxSkill}` : ''} · `}
                        {profession.recipes.length} recipe
                        {profession.recipes.length === 1 ? '' : 's'} · imported{' '}
                        {timeAgo(profession.importedAt)}
                      </span>
                    </button>
                    {canDrop && !SECONDARY_PROFESSIONS.includes(profession.name) && (
                      <button
                        type="button"
                        className="profession-drop"
                        onClick={() => drop(profession.name, profession.recipes.length)}
                      >
                        Drop this profession
                      </button>
                    )}
                  </div>
                  {open && (
                    <ul className="guild-recipes">
                      {profession.recipes.map((recipe) => (
                        <li key={`${recipe.kind}:${recipe.id}`}>
                          <div className="guild-recipe">
                            <a href={recipe.url} target="_blank" rel="noreferrer">
                              {recipe.icon && (
                                <img src={iconUrl(recipe.icon)} alt="" loading="lazy" />
                              )}
                              {recipe.name ??
                                `${recipe.kind === 'spell' ? 'Spell' : 'Item'} ${recipe.id}`}
                            </a>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
