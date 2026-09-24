import { useEffect, useState } from 'react';
import { fetchChannels } from './api';
import type { ServerChannels } from './types';

/** The text channels of every server of the guild, and a lookup from ids to a channel's name. */
export function useChannels(guildId: string): {
  channels: ServerChannels[];
  channelName: (serverId: string, channelId: string) => string | undefined;
} {
  const [channels, setChannels] = useState<ServerChannels[]>([]);

  useEffect(() => {
    fetchChannels(guildId)
      .then(setChannels)
      .catch(() => setChannels([]));
  }, [guildId]);

  const channelName = (serverId: string, channelId: string) =>
    channels
      .find((group) => group.serverId === serverId)
      ?.channels.find((channel) => channel.id === channelId)?.name;

  return { channels, channelName };
}
