import { useNavigate } from 'react-router-dom';
import { GuildSettings } from './GuildSettings';
import { guildPath } from './guildPath';
import type { Guild, Region } from './types';

interface Props {
  guild: Guild;
  regions: Region[];
  /** Reloads the user's guilds and returns the fresh list. */
  onGuildsChanged: () => Promise<Guild[]>;
}

/** `settings`: the guild's details, welcome post, roles, servers and request channel. */
export function SettingsPage({ guild, regions, onGuildsChanged }: Props) {
  const navigate = useNavigate();
  return (
    <GuildSettings
      key={guild.id}
      guild={guild}
      regions={regions}
      onChanged={async () => {
        const fresh = await onGuildsChanged();
        // Renaming a guild (or changing its realm or region) changes its address: follow it.
        const same = fresh.find((g) => g.id === guild.id);
        if (same && same.path !== guild.path) {
          navigate(guildPath(same, 'settings'), { replace: true });
        }
      }}
      onClose={() => navigate(guildPath(guild))}
      onDeleted={() => navigate('/')}
    />
  );
}
