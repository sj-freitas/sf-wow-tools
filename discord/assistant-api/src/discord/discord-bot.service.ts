import { REST } from '@discordjs/rest';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChannelType,
  Routes,
  type APIChannel,
  type APIGuildMember,
  type APIMessage,
  type APIUser,
} from 'discord-api-types/v10';

export interface ServerChannel {
  id: string;
  name: string;
}

export interface MessageReaction {
  /** Unicode emoji, or `name:id` for a custom emoji. */
  emoji: string;
  /** Set for custom emojis; used to show their image. */
  emojiId: string | null;
  count: number;
}

/** Text channels: regular and announcement. */
const TEXT_CHANNEL_TYPES = new Set<number>([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/**
 * What the worker and the tasks API need from Discord, using the bot token over REST.
 * `@discordjs/rest` queues requests to respect Discord's rate limits. Mentions in posts
 * never ping @everyone/@here.
 */
@Injectable()
export class DiscordBotService {
  private readonly rest: REST;
  private botUserId: string | null = null;

  constructor(configService: ConfigService) {
    this.rest = new REST({ version: '10' }).setToken(
      configService.getOrThrow<string>('DISCORD_TOKEN'),
    );
  }

  async getBotUserId(): Promise<string> {
    if (!this.botUserId) {
      const me = (await this.rest.get(Routes.user('@me'))) as APIUser;
      this.botUserId = me.id;
    }
    return this.botUserId;
  }

  async listTextChannels(serverId: string): Promise<ServerChannel[]> {
    const channels = (await this.rest.get(Routes.guildChannels(serverId))) as APIChannel[];
    return channels
      .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type) && 'name' in channel)
      .map((channel) => ({ id: channel.id, name: (channel as { name: string }).name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createTextChannel(
    serverId: string,
    options: { name: string; topic?: string },
  ): Promise<ServerChannel> {
    const channel = (await this.rest.post(Routes.guildChannels(serverId), {
      body: { name: options.name, type: ChannelType.GuildText, topic: options.topic },
      reason: 'Guild Assistant: honeypot channel',
    })) as APIChannel & { name: string };
    return { id: channel.id, name: channel.name };
  }

  async postMessage(channelId: string, content: string): Promise<string> {
    const message = (await this.rest.post(Routes.channelMessages(channelId), {
      body: { content, allowed_mentions: { parse: ['users', 'roles'] } },
    })) as APIMessage;
    return message.id;
  }

  /** Like postMessage, but mentions never ping anyone (used for log lines). */
  async postQuietMessage(channelId: string, content: string): Promise<string> {
    const message = (await this.rest.post(Routes.channelMessages(channelId), {
      body: { content, allowed_mentions: { parse: [] } },
    })) as APIMessage;
    return message.id;
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    await this.rest.patch(Routes.channelMessage(channelId, messageId), {
      body: { content, allowed_mentions: { parse: ['users', 'roles'] } },
    });
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.rest.put(
      Routes.channelMessageOwnReaction(channelId, messageId, encodeURIComponent(emoji)),
    );
  }

  async getReactions(channelId: string, messageId: string): Promise<MessageReaction[]> {
    const message = (await this.rest.get(
      Routes.channelMessage(channelId, messageId),
    )) as APIMessage;
    return (message.reactions ?? []).map((reaction) => ({
      emoji: reaction.emoji.id
        ? `${reaction.emoji.name ?? 'emoji'}:${reaction.emoji.id}`
        : (reaction.emoji.name ?? '?'),
      emojiId: reaction.emoji.id,
      count: reaction.count,
    }));
  }

  /** Role ids of a member of the server; an empty list if they are not in it. */
  async fetchMemberRoles(serverId: string, userId: string): Promise<string[]> {
    try {
      const member = (await this.rest.get(Routes.guildMember(serverId, userId))) as APIGuildMember;
      return member.roles;
    } catch {
      return [];
    }
  }

  /** Permanently bans the user and deletes their messages from the last `deleteMessageSeconds`. */
  async banMember(
    serverId: string,
    userId: string,
    options: { deleteMessageSeconds: number; reason: string },
  ): Promise<void> {
    await this.rest.put(Routes.guildBan(serverId, userId), {
      body: { delete_message_seconds: options.deleteMessageSeconds },
      reason: options.reason,
    });
  }
}
