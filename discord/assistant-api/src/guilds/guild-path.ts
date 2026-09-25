/**
 * A word or name as it appears in a web address: lower case, accents dropped, apostrophes
 * removed and any other run of punctuation or spaces turned into a single hyphen.
 * "Aerie Peak" -> "aerie-peak", "Azjol-Nerub" -> "azjol-nerub", "Mograine's Rest" -> "mograines-rest".
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'guild' : slug;
}

export interface GuildAddress {
  gameVersion: string;
  region: string;
  realm: string;
  name: string;
}

/** Where a guild lives in the backoffice: `<version>/<region>/<server>/<guild-name>`. */
export const guildPath = (guild: GuildAddress): string =>
  [guild.gameVersion, guild.region, guild.realm, guild.name].map(slugify).join('/');
