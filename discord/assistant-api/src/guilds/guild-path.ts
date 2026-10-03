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

/**
 * Where a guild lives in the backoffice: `<version>/<region>/<server>/guilds/<guild-name>`. The
 * literal `guilds` segment keeps this from colliding with `<version>/<region>/<server>/characters/…`
 * (a character's own, guild-agnostic page) at the same position in the address.
 */
export const guildPath = (guild: GuildAddress): string =>
  [guild.gameVersion, guild.region, guild.realm, 'guilds', guild.name].map(slugify).join('/');
