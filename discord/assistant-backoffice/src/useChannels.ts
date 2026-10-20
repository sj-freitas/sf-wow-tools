import { useEffect, useState } from 'react';
import { fetchChannels } from './api';
import type { ServerChannels } from './types';

/** How long a guild's channel list is reused before it is read again. */
const CACHE_MS = 60_000;

/**
 * The guilds' channel lists, shared by every picker on the page: one request per guild (in
 * flight or recent) instead of one per form field. A failed read isn't kept.
 */
const cache = new Map<string, { at: number; channels: Promise<ServerChannels[]> }>();

function channelsOf(guildId: string): Promise<ServerChannels[]> {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.channels;
  const channels = fetchChannels(guildId);
  cache.set(guildId, { at: Date.now(), channels });
  channels.catch(() => cache.delete(guildId));
  return channels;
}

/** The text channels of every server of the guild, and a lookup from ids to a channel's name. */
export function useChannels(guildId: string): {
  channels: ServerChannels[];
  channelName: (serverId: string, channelId: string) => string | undefined;
} {
  const [channels, setChannels] = useState<ServerChannels[]>([]);

  useEffect(() => {
    let current = true;
    channelsOf(guildId)
      .then((loaded) => current && setChannels(loaded))
      .catch(() => current && setChannels([]));
    return () => {
      current = false;
    };
  }, [guildId]);

  const channelName = (serverId: string, channelId: string) =>
    channels
      .find((group) => group.serverId === serverId)
      ?.channels.find((channel) => channel.id === channelId)?.name;

  return { channels, channelName };
}
