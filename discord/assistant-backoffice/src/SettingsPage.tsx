import { useNavigate } from 'react-router-dom';
import { GuildSettings } from './GuildSettings';
import type { Guild, Region } from './types';

interface Props {
  guild: Guild;
  regions: Region[];
  onGuildsChanged: () => Promise<void>;
}

/** `/settings`: the guild's details, servers and Discord roles. */
export function SettingsPage({ guild, regions, onGuildsChanged }: Props) {
  const navigate = useNavigate();
  return (
    <GuildSettings
      key={guild.id}
      guild={guild}
      regions={regions}
      onChanged={onGuildsChanged}
      onClose={() => navigate('/')}
    />
  );
}
