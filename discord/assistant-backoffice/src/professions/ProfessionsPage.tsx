import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { characterPath } from '../format';
import { fuzzyWordsScore } from '../fuzzy';
import { characterPagePath } from '../guildPath';
import type { Guild } from '../types';
import { HammerIcon } from '../Icons';
import { SkeletonLines } from '../Loading';
import { ADDON_URL, ImportProfessionsDrawer } from './ImportProfessionsDrawer';
import { fetchGuildProfessions, type GuildProfessions } from './professionsApi';
import './professions.css';

/** Wowhead's small icon for a spell or item. */
const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`;

/**
 * The guild's professions: per profession, every recipe the guild can craft and who, with search
 * (recipe, profession or crafter) and a profession filter, both kept in the address
 * (`?q=copper&prof=Blacksmithing`) so a search can be linked to. Imported with the Guild Assistant
 * Professions addon.
 */
export function ProfessionsPage({ guild }: { guild: Guild }) {
  const [data, setData] = useState<GuildProfessions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [params, setParams] = useSearchParams();
  // `/professions/<spell id>[/crafters]`: one recipe to show (its characters too with /crafters).
  const { craftId } = useParams();
  const target = craftId && /^\d+$/.test(craftId) ? Number(craftId) : null;
  const showCrafters = useLocation().pathname.endsWith('/crafters');
  const query = params.get('q') ?? '';
  const picked = params.getAll('prof');

  const load = useCallback(() => {
    setError(null);
    fetchGuildProfessions(guild.id)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id]);
  useEffect(load, [load]);

  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };
  const toggleProfession = (name: string) => {
    const next = new URLSearchParams(params);
    next.delete('prof');
    for (const value of picked.includes(name)
      ? picked.filter((n) => n !== name)
      : [...picked, name]) {
      next.append('prof', value);
    }
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete('q');
    next.delete('prof');
    setParams(next, { replace: true });
  };

  const characters = useMemo(
    () => new Map((data?.characters ?? []).map((character) => [character.id, character])),
    [data],
  );
  // Every profession in the guild, with how many recipes the guild can make in it.
  const professions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const recipe of data?.recipes ?? []) {
      counts.set(recipe.profession, (counts.get(recipe.profession) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  // The recipes shown, by profession: every word of the search must match the recipe's name, its
  // profession or one of its crafters ("copper shivan": Shivan's copper recipes).
  const shown = useMemo(() => {
    const groups = new Map<string, GuildProfessions['recipes']>();
    for (const recipe of data?.recipes ?? []) {
      if (picked.length > 0 && !picked.includes(recipe.profession)) continue;
      if (query.trim()) {
        const text = [
          recipe.name ?? String(recipe.id),
          recipe.profession,
          ...recipe.crafterIds.map((id) => characters.get(id)?.name ?? ''),
        ];
        if (fuzzyWordsScore(query, text) === null) continue;
      }
      groups.set(recipe.profession, [...(groups.get(recipe.profession) ?? []), recipe]);
    }
    return [...groups];
  }, [data, characters, picked, query]);

  const shownCount = shown.reduce((sum, [, recipes]) => sum + recipes.length, 0);
  const filtering = query.trim() !== '' || picked.length > 0;
  const unnamed = (data?.recipes ?? []).some((recipe) => !recipe.name);
  // Professions start collapsed and open while searching or filtering; a click flips one from
  // that (`toggled`), until the search starts or ends.
  const expanded = filtering;
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  useEffect(() => setToggled(new Set()), [expanded]);
  // The linked recipe's profession is open too (the page is about that recipe).
  const targetProfessions = useMemo(
    () => new Set((data?.recipes ?? []).filter((r) => r.id === target).map((r) => r.profession)),
    [data, target],
  );
  return (
    <div className="tasks">
      {importing && (
        <ImportProfessionsDrawer
          guildId={guild.id}
          onClose={() => {
            setImporting(false);
            load();
          }}
        />
      )}
      <div className="tasks-head">
        <div>
          <h3>Professions</h3>
          <p className="muted">
            What the guild can craft, from the Guild Assistant Professions addon.
          </p>
        </div>
        <div className="settings-actions">
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            <HammerIcon /> Import professions
          </button>
        </div>
      </div>

      {error ? (
        <div className="status status-error">
          <p>Could not load the professions: {error}</p>
          <button type="button" className="btn" onClick={load}>
            Retry
          </button>
        </div>
      ) : !data ? (
        <SkeletonLines count={8} />
      ) : data.recipes.length === 0 && data.characters.length === 0 ? (
        <p className="empty">
          No professions imported yet. Install the{' '}
          <a href={ADDON_URL} target="_blank" rel="noreferrer">
            Guild Assistant Professions addon
          </a>
          , open your professions’ windows in game, then Import professions here.
        </p>
      ) : (
        <>
          <div className="roster-filters">
            <div className="search-field">
              <input
                className="post-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search recipe, profession or crafter…"
                aria-label="Search the guild's recipes"
              />
            </div>
            <div className="roster-attribute-filter" role="group" aria-label="Filter by profession">
              {professions.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={picked.includes(name)}
                  className={
                    picked.includes(name)
                      ? 'profession-toggle profession-toggle-on'
                      : 'profession-toggle'
                  }
                  onClick={() => toggleProfession(name)}
                >
                  {name} <span className="muted">{count}</span>
                </button>
              ))}
            </div>
            {filtering && (
              <div className="roster-filter-summary">
                <span className="muted">
                  {shownCount} of {data.recipes.length} recipes
                </span>
                <button type="button" className="btn btn-sm" onClick={clearFilters}>
                  Clear
                </button>
              </div>
            )}
          </div>
          {unnamed && (
            <p className="muted">Some recipe names are still being looked up on Wowhead.</p>
          )}
          {target !== null && targetProfessions.size === 0 && (
            <p className="muted">Nobody in the guild can craft that recipe (any more).</p>
          )}
          {shown.length === 0 ? (
            <p className="empty">No recipes match.</p>
          ) : (
            shown.map(([profession, recipes]) => (
              <ProfessionSection
                key={profession}
                guild={guild}
                profession={profession}
                recipes={recipes}
                characters={characters}
                target={target}
                showCrafters={showCrafters}
                open={(expanded || targetProfessions.has(profession)) !== toggled.has(profession)}
                onToggle={() =>
                  setToggled((current) => {
                    const next = new Set(current);
                    if (!next.delete(profession)) next.add(profession);
                    return next;
                  })
                }
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

type Character = GuildProfessions['characters'][number];
type Recipe = GuildProfessions['recipes'][number];

/** One profession: its name and recipe count, and when open, its recipes. */
function ProfessionSection({
  guild,
  profession,
  recipes,
  characters,
  target,
  showCrafters,
  open,
  onToggle,
}: {
  guild: Guild;
  profession: string;
  recipes: Recipe[];
  characters: Map<string, Character>;
  /** The linked recipe's id: scrolled to and marked; `showCrafters` opens its characters. */
  target: number | null;
  showCrafters: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="guild-profession">
      <button
        type="button"
        className="guild-profession-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="guild-profession-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <strong>{profession}</strong>
        <span className="muted">
          {recipes.length} recipe{recipes.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <ul className="guild-recipes">
          {recipes.map((recipe) => (
            <RecipeRow
              key={`${recipe.kind}:${recipe.id}`}
              guild={guild}
              recipe={recipe}
              linked={recipe.id === target}
              showCrafters={recipe.id === target && showCrafters}
              crafters={recipe.crafterIds
                .map((id) => characters.get(id))
                .filter((c) => c !== undefined)
                .sort((a, b) => a.name.localeCompare(b.name))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A recipe (a Wowhead link) and how many can craft it; "View characters" lists them: each
 * character (its page), its player's Discord name, and a link to message them on Discord.
 */
function RecipeRow({
  guild,
  recipe,
  crafters,
  linked,
  showCrafters,
}: {
  guild: Guild;
  recipe: Recipe;
  crafters: Character[];
  /** The recipe a link pointed at: scrolled into view and marked. */
  linked: boolean;
  /** Its characters open from the start. */
  showCrafters: boolean;
}) {
  const [showing, setShowing] = useState(showCrafters);
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (linked) row.current?.scrollIntoView({ block: 'center' });
  }, [linked]);
  return (
    <li ref={row} className={linked ? 'guild-recipe-linked' : undefined}>
      {/* The whole row shows or hides the characters, except the Wowhead link. The button is
          there for the keyboard: its click bubbles up to the row. */}
      <div className="guild-recipe" onClick={() => setShowing((current) => !current)}>
        <a
          href={recipe.url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {recipe.icon && <img src={iconUrl(recipe.icon)} alt="" loading="lazy" />}
          {recipe.name ?? `${recipe.kind === 'spell' ? 'Spell' : 'Item'} ${recipe.id}`}
        </a>
        <button type="button" className="btn btn-sm" aria-expanded={showing}>
          View Characters
        </button>
      </div>
      {showing && (
        <ul className="guild-recipe-crafters">
          {crafters.map((character) => (
            <li key={character.id}>
              <Link to={characterPagePath(guild, characterPath(character))}>{character.name}</Link>
              {character.discordUserId && (
                <>
                  <span className="muted">@{character.discordName ?? character.discordUserId}</span>
                  {/* Discord's profile page, where "Message" opens a direct message. */}
                  <a
                    className="btn btn-sm"
                    href={`https://discord.com/users/${character.discordUserId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Message on Discord
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
