import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchProblems, type GuildProblem } from './api';
import type { Guild } from './types';

/** Tells every useGuildProblems to fetch again (after one is marked solved). */
const CHANGED = 'guild-problems-changed';
export const problemsChanged = () => window.dispatchEvent(new Event(CHANGED));

/**
 * What the bot can't do for the guild right now (empty when all is well), for Officers (shown in
 * Officer requests). Fetched again on each page change, so a fix shows soon after, and when one
 * is marked solved.
 */
export function useGuildProblems(guild: Guild): GuildProblem[] {
  const [problems, setProblems] = useState<GuildProblem[]>([]);
  const [version, setVersion] = useState(0);
  const { pathname } = useLocation();
  const allowed = guild.isOfficer;
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    fetchProblems(guild.id)
      .then((list) => live && setProblems(list))
      .catch(() => undefined); // nothing to show then
    return () => {
      live = false;
    };
  }, [guild.id, allowed, pathname, version]);
  return allowed ? problems : [];
}
