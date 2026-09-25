import { REST } from '@discordjs/rest';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChannelType,
  Routes,
  type APIChannel,
  type APIEmbed,
  type APIGuildMember,
  type APIMessage,
  type APIReaction,
  type APIUser,
} from 'discord-api-types/v10';

/** A file sent along with a message; embeds show it with `attachment://<name>`. */
export interface BotFile {
  name: string;
  data: Buffer;
  contentType: string;
}

/** Only files Discord itself hosts are downloaded. */
const DISCORD_FILE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

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

/**
 * Reaction counts without the bot's own vote. The bot adds each seed reaction itself so people
 * can click it, which would otherwise make every option start at 1. Options the bot seeded stay
 * in the list even at 0, so a poll shows all its choices.
 */
export function humanReactions(reactions: APIReaction[]): MessageReaction[] {
  return reactions.map((reaction) => ({
    emoji: reaction.emoji.id
      ? `${reaction.emoji.name ?? 'emoji'}:${reaction.emoji.id}`
      : (reaction.emoji.name ?? '?'),
    emojiId: reaction.emoji.id,
    count: reaction.me ? Math.max(0, reaction.count - 1) : reaction.count,
  }));
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
  private readonly applicationId: string | undefined;
  private readonly devServerId: string | undefined;
  /** Command ids only change if a command is deleted and created again, so they are kept. */
  private readonly commandIds = new Map<string, string>();

  constructor(configService: ConfigService) {
    this.applicationId = configService.get<string>('DISCORD_APPLICATION_ID');
    this.devServerId = configService.get<string>('DISCORD_GUILD_ID') || undefined;
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

  /**
   * A clickable mention of a slash command (`</name:id>`): clicking it puts the command in the
   * user's message box. Null when the command can't be found, so callers fall back to plain text.
   */
  async getCommandMention(name: string): Promise<string | null> {
    let id = this.commandIds.get(name);
    if (!id) {
      id = await this.lookUpCommandId(name);
      if (!id) return null;
      this.commandIds.set(name, id);
    }
    return `</${name}:${id}>`;
  }

  private async lookUpCommandId(name: string): Promise<string | undefined> {
    if (!this.applicationId) return undefined;
    // `commands:register` puts commands in one server while DISCORD_GUILD_ID is set, else everywhere.
    const routes = [
      Routes.applicationCommands(this.applicationId),
      ...(this.devServerId
        ? [Routes.applicationGuildCommands(this.applicationId, this.devServerId)]
        : []),
    ];
    for (const route of routes) {
      try {
        const commands = (await this.rest.get(route)) as { id: string; name: string }[];
        const found = commands.find((command) => command.name === name);
        if (found) return found.id;
      } catch {
        // Not being able to look it up only costs the clickable mention.
      }
    }
    return undefined;
  }

  /** Downloads a file from Discord's CDN; null if it is somewhere else, too big or unavailable. */
  async downloadAttachment(url: string, maxBytes: number): Promise<Buffer | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || !DISCORD_FILE_HOSTS.has(parsed.hostname)) return null;
    const response = await fetch(parsed);
    if (!response.ok) return null;
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes) return null;
    const data = Buffer.from(await response.arrayBuffer());
    return data.length > maxBytes ? null : data;
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

  /**
   * Posts an embed. Mentions inside never ping anyone. With `replyTo` it shows as a reply to that
   * message (and still posts if that message was deleted).
   */
  async postEmbed(
    channelId: string,
    embed: APIEmbed,
    options: { replyTo?: string; file?: BotFile } = {},
  ): Promise<string> {
    const message = (await this.rest.post(Routes.channelMessages(channelId), {
      files: options.file ? [options.file] : undefined,
      body: {
        embeds: [embed],
        allowed_mentions: { parse: [] },
        ...(options.replyTo
          ? { message_reference: { message_id: options.replyTo, fail_if_not_exists: false } }
          : {}),
      },
    })) as APIMessage;
    return message.id;
  }

  /** Sends a direct message. Fails (Discord error 50007) when the user does not accept DMs. */
  async sendDirectMessage(
    userId: string,
    embed: APIEmbed,
    components?: unknown[],
    file?: BotFile,
  ): Promise<void> {
    const dm = (await this.rest.post(Routes.userChannels(), {
      body: { recipient_id: userId },
    })) as APIChannel;
    await this.rest.post(Routes.channelMessages(dm.id), {
      files: file ? [file] : undefined,
      body: { embeds: [embed], components, allowed_mentions: { parse: [] } },
    });
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    await this.rest.patch(Routes.channelMessage(channelId, messageId), {
      body: { content, allowed_mentions: { parse: ['users', 'roles'] } },
    });
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.rest.delete(Routes.channelMessage(channelId, messageId));
  }

  /** One page (up to 100) of a channel's messages, newest first, older than `before`. */
  async listMessages(
    channelId: string,
    before?: string,
  ): Promise<{ id: string; pinned: boolean }[]> {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const messages = (await this.rest.get(Routes.channelMessages(channelId), {
      query,
    })) as APIMessage[];
    return messages.map((message) => ({ id: message.id, pinned: message.pinned }));
  }

  /** Deletes 2-100 messages at once. Discord refuses ones older than 14 days. */
  async bulkDeleteMessages(channelId: string, messageIds: string[]): Promise<void> {
    await this.rest.post(Routes.channelBulkDelete(channelId), {
      body: { messages: messageIds },
    });
  }

  /** Replaces the text of the reply to a command (valid for 15 minutes after the command). */
  async editInteractionReply(applicationId: string, token: string, content: string): Promise<void> {
    await this.rest.patch(Routes.webhookMessage(applicationId, token, '@original'), {
      body: { content, allowed_mentions: { parse: [] } },
      auth: false,
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
    return humanReactions(message.reactions ?? []);
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
