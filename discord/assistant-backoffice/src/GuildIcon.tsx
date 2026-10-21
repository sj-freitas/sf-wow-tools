import type { Guild } from './types';

/**
 * The guild's logo: the picture of its main Discord server, or its first letter when the server has
 * none. In the guild's header and on its card in the overview.
 */
export function GuildIcon({ guild }: { guild: Pick<Guild, 'name' | 'servers'> }) {
  const main = guild.servers.find((server) => server.isMain);
  if (main?.icon) {
    return (
      <img
        className="guild-icon"
        src={`https://cdn.discordapp.com/icons/${main.discordId}/${main.icon}.png?size=128`}
        alt=""
      />
    );
  }
  return (
    <span className="guild-icon guild-icon-fallback">{guild.name.charAt(0).toUpperCase()}</span>
  );
}
