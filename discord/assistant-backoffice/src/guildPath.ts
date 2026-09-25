import type { Guild } from './types';

/**
 * A page of a guild. Every guild page lives under the guild's address
 * (`/<version>/<region>/<server>/<guild-name>`), which the API builds.
 */
export const guildPath = (guild: Pick<Guild, 'path'>, sub = ''): string =>
  `/${guild.path}${sub ? `/${sub}` : ''}`;
