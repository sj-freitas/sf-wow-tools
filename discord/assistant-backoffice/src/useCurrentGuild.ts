import { useLocation } from 'react-router-dom';
import { guildPath } from './guildPath';
import type { Guild } from './types';

/** The guild the page is in (its address starts with the guild's), if any. */
export function useCurrentGuild(guilds: Guild[]): Guild | undefined {
  const { pathname } = useLocation();
  return guilds.find(
    (guild) => pathname === guildPath(guild) || pathname.startsWith(`${guildPath(guild)}/`),
  );
}
