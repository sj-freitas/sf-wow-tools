import { BadRequestException } from '@nestjs/common';
import { describeDiscordError } from '../discord/discord-errors';
import { parseSnowflake } from '../tasks/post-task';
import type { PluginContext } from './plugin-kinds';

/** A plugin's `serverId` and `channelId`, checked: a text channel of one of the guild's servers. */
export async function parseGuildChannel(
  config: Record<string, unknown>,
  context: PluginContext,
): Promise<{ serverId: string; channelId: string }> {
  const serverId = parseSnowflake(config.serverId, 'The server');
  const channelId = parseSnowflake(config.channelId, 'The channel');
  if (!context.serverIds.includes(serverId)) {
    throw new BadRequestException('That server is not part of this guild.');
  }
  let channels;
  try {
    channels = await context.bot.listTextChannels(serverId);
  } catch (error) {
    throw new BadRequestException(
      `Could not read the server's channels: ${describeDiscordError(error)}`,
    );
  }
  if (!channels.some((channel) => channel.id === channelId)) {
    throw new BadRequestException('That channel is not a text channel of the chosen server.');
  }
  return { serverId, channelId };
}
