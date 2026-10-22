import { useEffect, useMemo, useState } from 'react';
import { Drawer } from '../Drawer';
import { fuzzyWordsScore } from '../fuzzy';
import { Spinner } from '../Loading';
import { timeAgo } from '../time';
import { ADDON_URL } from './ImportProfessionsDrawer';
import { fetchProfessions, type Profession } from './professionsApi';
import './professions.css';

/** Wowhead's small icon for a spell or item. */
const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`;

/**
 * A character's professions and recipes (imported with the GuildAssistant Professions addon),
 * each recipe linking to Wowhead. Recipe names may still be loading right after an import.
 */
export function ProfessionsDrawer({
  guildId,
  character,
  onClose,
}: {
  guildId: string;
  character: { id: string; name: string };
  onClose: () => void;
}) {
  const [professions, setProfessions] = useState<Profession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchProfessions(guildId, character.id)
      .then(setProfessions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guildId, character.id]);

  const shown = useMemo(
    () =>
      (professions ?? []).map((profession) => ({
        ...profession,
        recipes: query.trim()
          ? profession.recipes.filter(
              (recipe) => fuzzyWordsScore(query, [recipe.name ?? String(recipe.id)]) !== null,
            )
          : profession.recipes,
      })),
    [professions, query],
  );
  const total = (professions ?? []).reduce((sum, p) => sum + p.recipes.length, 0);
  const unnamed = (professions ?? []).some((p) => p.recipes.some((recipe) => !recipe.name));

  return (
    <Drawer title={`${character.name}: professions`} onClose={onClose}>
      {error ? (
        <p className="status-error">{error}</p>
      ) : !professions ? (
        <Spinner />
      ) : professions.length === 0 ? (
        <p className="empty">
          No professions imported yet. Its player imports them with the{' '}
          <a href={ADDON_URL} target="_blank" rel="noreferrer">
            GuildAssistant Professions addon
          </a>{' '}
          (Professions, Import professions).
        </p>
      ) : (
        <div className="professions">
          {total > 0 && (
            <div className="search-field">
              <span className="search-icon" aria-hidden="true">
                🔍
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search recipes…"
                aria-label="Search recipes"
              />
            </div>
          )}
          {unnamed && (
            <p className="muted">Some recipe names are still being looked up on Wowhead.</p>
          )}
          {shown.map((profession) => (
            <section key={profession.name} className="profession">
              <h4>
                {profession.name}
                {profession.skill !== null && (
                  <span className="muted">
                    {' '}
                    {profession.skill}
                    {profession.maxSkill ? ` / ${profession.maxSkill}` : ''}
                  </span>
                )}
              </h4>
              <p className="muted profession-meta">
                {profession.recipes.length} recipe{profession.recipes.length === 1 ? '' : 's'}
                {query.trim() ? ' match' : ''} · imported {timeAgo(profession.importedAt)}
              </p>
              {profession.recipes.length > 0 && (
                <ul className="recipe-list">
                  {profession.recipes.map((recipe) => (
                    <li key={`${recipe.kind}:${recipe.id}`}>
                      <a href={recipe.url} target="_blank" rel="noreferrer">
                        {recipe.icon && <img src={iconUrl(recipe.icon)} alt="" loading="lazy" />}
                        {recipe.name ??
                          `${recipe.kind === 'spell' ? 'Spell' : 'Item'} ${recipe.id}`}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Drawer>
  );
}
