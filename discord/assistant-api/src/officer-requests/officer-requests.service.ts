import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError } from '../discord/discord-errors';
import {
  IMAGE_MESSAGES,
  MAX_IMAGE_BYTES,
  neutralFileName,
  toMessageImage,
  type MessageImage,
} from './attachments';
import type { DiscordAttachment } from '../bot/discord-interaction.types';
import { RealtimeService } from '../realtime/realtime.service';
import {
  memberDmEmbed,
  officerReplyEmbed,
  replyButtonRow,
  replyInstructions,
  requestEmbed,
} from './officer-request-embeds';

/** Who used the command, as Discord tells us. */
export interface Invoker {
  id: string;
  /** Server nickname, else display name, else username. */
  name: string;
  /** Their role ids in the server the command was used in, when Discord included them. */
  roleIds?: readonly string[];
}

const fileOption = (image?: MessageImage) => {
  const file = discordFile(image);
  return file ? { file } : {};
};

const discordFile = (image?: MessageImage) =>
  image
    ? { name: neutralFileName(image), data: image.data, contentType: image.contentType }
    : undefined;

/** Nested create data that keeps an image with its message. */
const attachmentData = (image?: MessageImage) =>
  image
    ? {
        attachment: {
          create: {
            contentType: image.contentType,
            size: image.data.length,
            data: new Uint8Array(image.data),
          },
        },
      }
    : {};

const GUILD_SELECT = {
  id: true,
  name: true,
  realm: true,
  officerRoleId: true,
  officerRequestChannelId: true,
  servers: { where: { isMain: true }, select: { discordId: true } },
} as const;

export const MAX_MESSAGE_LENGTH = 3500;
/** A member has to wait this long between two messages to the officers. */
export const MESSAGE_COOLDOWN_MS = 30_000;
const ID_ATTEMPTS = 8;

export const MESSAGES = {
  serverOnly: 'This command can only be used inside a server.',
  notLinked: "This server isn't linked to a guild yet.",
  channelNotSet:
    'The Officer Request Channel is not setup for your guild, please contact an officer to set it up.',
  cooldown: 'Please wait a few seconds before sending another message.',
  conversationNotFound:
    "I couldn't find that conversation. Check the conversation ID: only the member who started a conversation can continue it.",
  locked:
    'This conversation is now locked, so nobody can write to it any more. You can start a new conversation with /contact-officer.',
  officerConversationNotFound: 'There is no conversation with that ID in this guild.',
  notOfficer: "You don't have permission to use this command. Only officers can reply to requests.",
  noOfficerRole:
    'This guild has no Officer role set up, so nobody can reply yet. A Guild-Assistant can set it in the guild settings.',
  deliveryFailed:
    'Something went wrong delivering your message to the officers. Please try again later, or contact an officer directly.',
} as const;

@Injectable()
export class OfficerRequestsService {
  private readonly logger = new Logger(OfficerRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Downloads the file a member attached to a command and checks it is an allowed image. Returns
   * the image, undefined when nothing was attached, or the message to show when it can't be used.
   */
  async loadImage(
    attachment: DiscordAttachment | undefined,
  ): Promise<MessageImage | string | undefined> {
    if (!attachment) return undefined;
    if (attachment.size > MAX_IMAGE_BYTES) return IMAGE_MESSAGES.tooBig;
    if (attachment.content_type && !attachment.content_type.startsWith('image/')) {
      return IMAGE_MESSAGES.notImage;
    }
    let data: Buffer | null = null;
    try {
      data = await this.bot.downloadAttachment(attachment.url, MAX_IMAGE_BYTES);
    } catch (error) {
      this.logger.warn(`Could not download an attachment: ${describeDiscordError(error)}`);
    }
    return data ? toMessageImage(data) : IMAGE_MESSAGES.unreadable;
  }

  /**
   * `/contact-officer`: posts the member's message in the guild's Officer Request Channel. The
   * first message of a conversation decides whether the member is anonymous; follow-ups (with
   * the conversation id) ignore the `anonymous` option. Returns the private answer for the member.
   */
  async contact(input: {
    /** The server the command was used in. Buttons have no server and pass `guildId` instead. */
    serverId?: string;
    guildId?: string;
    invoker: Invoker;
    message: string;
    anonymous?: boolean;
    conversationId?: number;
    image?: MessageImage;
  }): Promise<string> {
    const guild = input.guildId
      ? await this.findGuildById(input.guildId)
      : input.serverId
        ? await this.findGuildOfServer(input.serverId)
        : null;
    if (!guild) return MESSAGES.notLinked;
    if (!guild.officerRequestChannelId) return MESSAGES.channelNotSet;

    const recent = await this.prisma.officerMessage.findFirst({
      where: {
        author: 'USER',
        createdAt: { gt: new Date(Date.now() - MESSAGE_COOLDOWN_MS) },
        conversation: { guildId: guild.id, userDiscordId: input.invoker.id },
      },
      select: { id: true },
    });
    if (recent) return MESSAGES.cooldown;

    // Only whoever started a conversation can continue it; anyone else is told it doesn't exist.
    const existing =
      input.conversationId === undefined
        ? null
        : await this.prisma.officerConversation.findFirst({
            where: {
              guildId: guild.id,
              publicId: input.conversationId,
              userDiscordId: input.invoker.id,
            },
            include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
          });
    if (input.conversationId !== undefined && !existing) return MESSAGES.conversationNotFound;
    if (existing?.lockedAt) return MESSAGES.locked;

    const isAnonymous = existing ? existing.isAnonymous : (input.anonymous ?? true);
    const publicId = existing?.publicId ?? (await this.newPublicId(guild.id));

    let discordMessageId: string;
    try {
      discordMessageId = await this.bot.postEmbed(
        guild.officerRequestChannelId,
        requestEmbed({
          publicId,
          content: input.message,
          isAnonymous,
          userId: input.invoker.id,
          followUp: existing !== null,
          imageName: input.image && neutralFileName(input.image),
        }),
        {
          replyTo: existing?.messages[0]?.discordMessageId ?? undefined,
          ...fileOption(input.image),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not post to the officer request channel: ${describeDiscordError(error)}`,
      );
      return MESSAGES.deliveryFailed;
    }

    const message = {
      author: 'USER' as const,
      content: input.message,
      discordMessageId,
      ...attachmentData(input.image),
    };
    if (existing) {
      await this.prisma.officerMessage.create({
        data: { ...message, conversationId: existing.id },
      });
      await this.prisma.officerConversation.update({
        where: { id: existing.id },
        data: { updatedAt: new Date() },
      });
    } else {
      await this.prisma.officerConversation.create({
        data: {
          guildId: guild.id,
          publicId,
          isAnonymous,
          userDiscordId: input.invoker.id,
          userName: isAnonymous ? null : input.invoker.name,
          messages: { create: message },
        },
      });
    }
    this.realtime.publish(guild.id, 'officer-requests');

    return [
      existing
        ? `Your follow-up was sent to the officers of ${guild.name}.`
        : `Your message was sent to the officers of ${guild.name}${isAnonymous ? ', anonymously' : ', with your name'}.`,
      `Conversation ID: **${publicId}**. Keep it: officers reply to you by DM.`,
      replyInstructions(guild.name, publicId, await this.bot.getCommandMention('contact-officer')),
    ].join('\n');
  }

  /**
   * `/contact-officer-reply`: an officer answers a conversation. The reply is posted in the
   * request channel (showing which officer wrote it), saved, and sent to the member by DM.
   * Returns the private answer for the officer.
   */
  async reply(input: {
    serverId: string;
    invoker: Invoker;
    conversationId: number;
    message: string;
    image?: MessageImage;
  }): Promise<string> {
    const guild = await this.findGuildOfServer(input.serverId);
    if (!guild) return MESSAGES.notLinked;
    if (!guild.officerRoleId) return MESSAGES.noOfficerRole;
    if (!(await this.isOfficer(guild, input.serverId, input.invoker))) return MESSAGES.notOfficer;

    const conversation = await this.prisma.officerConversation.findUnique({
      where: { guildId_publicId: { guildId: guild.id, publicId: input.conversationId } },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) return MESSAGES.officerConversationNotFound;
    if (conversation.lockedAt) return MESSAGES.locked;

    const { dmDelivered } = await this.deliverReply(
      guild,
      conversation,
      input.invoker,
      input.message,
      input.image,
    );

    return dmDelivered
      ? `Your reply to conversation #${conversation.publicId} was sent to the member by DM and posted in the request channel.`
      : `Your reply to conversation #${conversation.publicId} was saved and posted, but the member could not be reached by DM (they may have DMs closed). Consider reaching out to them directly.`;
  }

  /**
   * The backoffice's way to reply: same delivery as /contact-officer-reply. The caller has already
   * checked that the user is an Officer of the guild.
   */
  async replyAsOfficer(
    guildId: string,
    publicId: number,
    officer: { id: string; name: string },
    message: string,
    image?: MessageImage,
  ): Promise<{ dmDelivered: boolean }> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { id: true, name: true, realm: true, officerRequestChannelId: true },
    });
    if (!guild) throw new NotFoundException('Guild not found');
    const conversation = await this.prisma.officerConversation.findUnique({
      where: { guildId_publicId: { guildId, publicId } },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException(MESSAGES.officerConversationNotFound);
    if (conversation.lockedAt) throw new ConflictException(MESSAGES.locked);
    return this.deliverReply(guild, conversation, officer, message, image);
  }

  /** Locks (or unlocks) a conversation: while locked, members and officers can't write to it. */
  async setLocked(guildId: string, publicId: number, locked: boolean): Promise<void> {
    const { count } = await this.prisma.officerConversation.updateMany({
      where: { guildId, publicId },
      data: { lockedAt: locked ? new Date() : null },
    });
    if (count === 0) throw new NotFoundException(MESSAGES.officerConversationNotFound);
    this.realtime.publish(guildId, 'officer-requests');
  }

  /**
   * Removes a conversation from the database and its messages from the request channel. DMs
   * already sent to the member stay. Returns how many channel messages could not be deleted
   * (already removed by hand, or the channel was changed since).
   */
  async deleteConversation(guildId: string, publicId: number): Promise<{ notDeleted: number }> {
    const conversation = await this.prisma.officerConversation.findUnique({
      where: { guildId_publicId: { guildId, publicId } },
      include: { messages: true, guild: { select: { officerRequestChannelId: true } } },
    });
    if (!conversation) throw new NotFoundException(MESSAGES.officerConversationNotFound);

    let notDeleted = 0;
    const channelId = conversation.guild.officerRequestChannelId;
    for (const message of conversation.messages) {
      if (!message.discordMessageId) continue;
      if (!channelId) {
        notDeleted++;
        continue;
      }
      try {
        await this.bot.deleteMessage(channelId, message.discordMessageId);
      } catch (error) {
        notDeleted++;
        this.logger.warn(`Could not delete a request message: ${describeDiscordError(error)}`);
      }
    }
    await this.prisma.officerConversation.delete({ where: { id: conversation.id } });
    this.realtime.publish(guildId, 'officer-requests');
    return { notDeleted };
  }

  /** Posts the reply in the request channel, DMs the member and saves it. */
  private async deliverReply(
    guild: { id: string; name: string; realm: string; officerRequestChannelId: string | null },
    conversation: {
      id: string;
      publicId: number;
      userDiscordId: string;
      messages: { author: string; content: string; discordMessageId: string | null }[];
    },
    officer: { id: string; name: string },
    message: string,
    image?: MessageImage,
  ): Promise<{ dmDelivered: boolean }> {
    const firstRequest = conversation.messages.find((m) => m.author === 'USER');
    let discordMessageId: string | null = null;
    if (guild.officerRequestChannelId) {
      try {
        discordMessageId = await this.bot.postEmbed(
          guild.officerRequestChannelId,
          officerReplyEmbed({
            publicId: conversation.publicId,
            officerName: officer.name,
            content: message,
            imageName: image && neutralFileName(image),
          }),
          { replyTo: firstRequest?.discordMessageId ?? undefined, ...fileOption(image) },
        );
      } catch (error) {
        // The reply still counts: it is saved and the member still gets it.
        this.logger.warn(
          `Could not post the reply in the request channel: ${describeDiscordError(error)}`,
        );
      }
    }

    const commandMention = await this.bot.getCommandMention('contact-officer');
    let dmDelivered = true;
    try {
      await this.bot.sendDirectMessage(
        conversation.userDiscordId,
        memberDmEmbed({
          guildName: guild.name,
          guildRealm: guild.realm,
          publicId: conversation.publicId,
          officerName: officer.name,
          originalRequest: firstRequest?.content ?? '',
          reply: message,
          commandMention,
          withButton: true,
          imageName: image && neutralFileName(image),
        }),
        replyButtonRow(guild.id, conversation.publicId),
        discordFile(image),
      );
    } catch (error) {
      dmDelivered = false;
      this.logger.warn(`Could not DM a reply: ${describeDiscordError(error)}`);
    }

    await this.prisma.officerMessage.create({
      data: {
        conversationId: conversation.id,
        author: 'OFFICER',
        officerDiscordId: officer.id,
        officerName: officer.name,
        content: message,
        discordMessageId,
        dmDelivered,
        ...attachmentData(image),
      },
    });
    await this.prisma.officerConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });
    this.realtime.publish(guild.id, 'officer-requests');

    return { dmDelivered };
  }

  /**
   * Sets (or, with null, clears) the guild's Officer Request Channel. The channel must be in one
   * of the guild's servers, and the bot posts a short note there to prove it can write.
   */
  async setChannel(
    guildId: string,
    target: { serverId: string; channelId: string } | null,
  ): Promise<void> {
    if (target) {
      const server = await this.prisma.discordServer.findFirst({
        where: { guildId, discordId: target.serverId },
        select: { id: true },
      });
      if (!server) throw new BadRequestException('That server is not part of this guild.');
      try {
        const channels = await this.bot.listTextChannels(target.serverId);
        if (!channels.some((channel) => channel.id === target.channelId)) {
          throw new BadRequestException('That channel is not in the chosen server.');
        }
        await this.bot.postMessage(
          target.channelId,
          "This is now the Officer Request Channel: members' messages sent with /contact-officer will appear here. Reply with /contact-officer-reply.",
        );
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException(
          `The bot could not write in that channel: ${describeDiscordError(error)}`,
        );
      }
    }
    await this.prisma.guild.update({
      where: { id: guildId },
      data: {
        officerRequestServerId: target?.serverId ?? null,
        officerRequestChannelId: target?.channelId ?? null,
      },
    });
  }

  /**
   * Whether this member may write to the conversation: null if so, else the message to show. Used
   * by the Reply button before it opens the form.
   */
  async checkCanContinue(
    guildId: string,
    publicId: number,
    userDiscordId: string,
  ): Promise<string | null> {
    const conversation = await this.prisma.officerConversation.findFirst({
      where: { guildId, publicId, userDiscordId },
      select: { lockedAt: true },
    });
    if (!conversation) return MESSAGES.conversationNotFound;
    return conversation.lockedAt ? MESSAGES.locked : null;
  }

  private findGuildById(guildId: string) {
    return this.prisma.guild.findUnique({ where: { id: guildId }, select: GUILD_SELECT });
  }

  private findGuildOfServer(serverId: string) {
    return this.prisma.guild.findFirst({
      where: { servers: { some: { discordId: serverId } } },
      select: GUILD_SELECT,
    });
  }

  /** Officers hold the guild's Officer role in its main server. */
  private async isOfficer(
    guild: { officerRoleId: string | null; servers: { discordId: string }[] },
    serverId: string,
    invoker: Invoker,
  ): Promise<boolean> {
    const main = guild.servers[0]?.discordId;
    if (!guild.officerRoleId || !main) return false;
    const roles =
      main === serverId && invoker.roleIds
        ? invoker.roleIds
        : await this.bot.fetchMemberRoles(main, invoker.id);
    return roles.includes(guild.officerRoleId);
  }

  /** A random 8-digit id that no conversation of the guild uses yet. */
  private async newPublicId(guildId: string): Promise<number> {
    for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
      const candidate = randomInt(10_000_000, 100_000_000);
      const taken = await this.prisma.officerConversation.findUnique({
        where: { guildId_publicId: { guildId, publicId: candidate } },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    throw new NotFoundException('Could not find a free conversation id');
  }
}
