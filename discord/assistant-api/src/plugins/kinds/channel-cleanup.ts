import { BadRequestException } from '@nestjs/common';
import { describeDiscordError } from '../../discord/discord-errors';
import { cleanChannel } from '../../moderation/channel-cleaner';
import { parseSnowflake } from '../../tasks/post-task';
import type { PluginKindDef } from '../plugin-kinds';

export interface ChannelCleanupConfig {
  serverId: string;
  channelId: string;
  /** Keep the messages of bots and webhooks (on by default). Pinned messages are always kept. */
  keepBotMessages: boolean;
}

/** Between runs: an unfinished clean-up's place, and what it deleted so far. */
interface ChannelCleanupState {
  cursor?: string;
  deletedSoFar?: number;
}

const plural = (count: number) => `${count} message${count === 1 ? '' : 's'}`;

/**
 * Channel Clean Up: on its schedule, deletes a channel's messages except pinned ones and (by
 * default) those of bots. A big channel takes several runs: each stops before the worker's lease
 * ends and the next carries on a minute later from where it stopped.
 */
export const CHANNEL_CLEANUP: PluginKindDef<ChannelCleanupConfig> = {
  kind: 'CHANNEL_CLEANUP',
  label: 'Channel Clean Up',
  description:
    'Deletes the messages of a channel on a schedule, keeping pinned messages and the messages of bots.',

  async parseConfig(input, context) {
    const config = (input ?? {}) as Record<string, unknown>;
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
    return { serverId, channelId, keepBotMessages: config.keepBotMessages !== false };
  },

  async run(plugin, context, deadline) {
    const state = plugin.state as ChannelCleanupState;
    const soFar = state.cursor ? (state.deletedSoFar ?? 0) : 0;
    const outcome = await cleanChannel(
      context.bot,
      plugin.config.channelId,
      { keepBotMessages: plugin.config.keepBotMessages, before: state.cursor, deadline },
      context.clock,
    );
    const deleted = soFar + outcome.deleted;
    if (!outcome.done) {
      return {
        result: `Deleted ${plural(deleted)} so far; carrying on.`,
        state: { cursor: outcome.cursor, deletedSoFar: deleted },
        more: true,
      };
    }
    return {
      result: deleted === 0 ? 'Nothing to delete.' : `Deleted ${plural(deleted)}.`,
      state: {},
    };
  },
};
