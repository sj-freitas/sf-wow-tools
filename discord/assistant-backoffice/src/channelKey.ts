/** A channel in a dropdown is identified as `serverId:channelId`. */
export const channelKey = (serverId: string, channelId: string): string =>
  `${serverId}:${channelId}`;

export const splitChannelKey = (key: string): { serverId: string; channelId: string } => {
  const [serverId = '', channelId = ''] = key.split(':');
  return { serverId, channelId };
};
