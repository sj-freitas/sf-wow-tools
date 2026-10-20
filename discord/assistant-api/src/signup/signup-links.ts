import { guildPath, type GuildAddress } from '../guilds/guild-path';

export const eventPageUrl = (origin: string, guild: GuildAddress, eventId: string): string =>
  `${origin}/${guildPath(guild)}/signup/${eventId}`;

export const addCharacterUrl = (origin: string, guild: GuildAddress): string =>
  `${origin}/${guildPath(guild)}/roster/create`;

export const editCharacterUrl = (
  origin: string,
  guild: GuildAddress,
  characterId: string,
): string => `${origin}/${guildPath(guild)}/roster/edit/${characterId}`;
