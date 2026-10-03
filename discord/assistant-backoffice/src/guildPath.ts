import type { Guild } from './types';

/**
 * A page of a guild. Every guild page lives under the guild's address
 * (`/<version>/<region>/<server>/guilds/<guild-name>`), which the API builds.
 */
export const guildPath = (guild: Pick<Guild, 'path'>, sub = ''): string =>
  `/${guild.path}${sub ? `/${sub}` : ''}`;

/**
 * A character's own page: guild-agnostic, under its server
 * (`/<version>/<region>/<server>/characters/<name>`), the same address regardless of which guild
 * it is in, or none. `namePath` is `Name-Lastname` (or `Name`), as `characterPath` builds it.
 */
export const characterPagePath = (
  server: { gameVersion: string; region: string; realm: string },
  namePath: string,
  sub = '',
): string =>
  `/${[server.gameVersion, server.region, server.realm].map((s) => s.toLowerCase()).join('/')}/characters/${namePath}${sub ? `/${sub}` : ''}`;
