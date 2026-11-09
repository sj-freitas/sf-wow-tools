// How a recipe and its crafters read in Discord, the same in the Guild Chat Profession Listener's
// answers (crafter-listener.service.ts) and the Professions List (professions-post.plugin.ts):
// "- [Bronze Mace], crafters: Shivan Darkwhisp (@Shivan), Tearyn Trakand (@Tearyn)".

/** Discord markdown's special characters escaped, so a name shows as it is written. */
export const escapeMarkdown = (text: string): string => text.replace(/([\\*_~`|[\]<>])/g, '\\$1');

/**
 * "[Bronze Mace]" like the game's item links, the name opening its Wowhead page. The brackets go
 * around the link, escaped: inside a link's text Discord shows a backslash as typed ("\[Bronze
 * Mace\]"), so nothing is escaped there; brackets are just left out of the name.
 */
export const itemLink = (name: string, url: string): string =>
  `\\[[${name.replace(/[[\]]/g, '')}](<${url}>)\\]`;

/**
 * A crafter: its character's name and its player's Discord mention in brackets ("Shivan Darkwhisp
 * (<@…>)", shown as "Shivan Darkwhisp (@Shivan)"), which opens their profile in Discord and pings
 * nobody (messages are sent with no allowed mentions). Not a discord.com/users link: Discord puts a
 * profile card under the message for each of those, link previews off or not. Just the name for a
 * character with no Discord account.
 */
export const crafterName = (character: string, discordUserId: string | null): string =>
  discordUserId ? `${escapeMarkdown(character)} (<@${discordUserId}>)` : escapeMarkdown(character);

/** Where a Discord profile opens through Guild Assistant (`/api/public/discord/users/<id>`). */
export const profileUrl = (origin: string, discordUserId: string): string =>
  `${origin}/api/public/discord/users/${discordUserId}`;

/** A link's text: nothing escaped (Discord shows a backslash there as typed), brackets left out. */
const linkText = (text: string): string => text.replace(/[[\]]/g, '');

/**
 * A crafter in the Professions List: its character's name linking to its Guild Assistant page
 * (`page`, its Professions tab), then its player's Discord name linking to their Discord profile
 * through Guild Assistant (`profile`): "[Vrax Duskwalker](<…/characters/Vrax-Duskwalker/professions>)
 * ([Verexs](<…/api/public/discord/users/…>))". Not a mention: a list of hundreds of them tags
 * everyone all over the channel. Not a discord.com/users link: Discord puts a profile card under
 * the message for each. Each part is left out (plain name, no brackets) when it isn't known.
 */
export const crafterLinks = (
  character: string,
  page: string | null,
  profile: { name: string | null; url: string } | null,
): string => {
  const name = page ? `[${linkText(character)}](<${page}>)` : escapeMarkdown(character);
  return profile ? `${name} ([${linkText(profile.name ?? 'Discord')}](<${profile.url}>))` : name;
};

/** "- [Bronze Mace], crafters: …": a recipe's line, `count` crafters in all, `crafters` as shown. */
export const recipeLine = (item: string, count: number, crafters: string): string =>
  `- ${item}, crafter${count === 1 ? '' : 's'}: ${crafters}`;
