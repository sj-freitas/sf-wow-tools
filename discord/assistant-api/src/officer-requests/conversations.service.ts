import { Injectable, NotFoundException } from '@nestjs/common';
import type { OfficerConversation, OfficerMessage } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { clampPage, PAGE_SIZE, searchTerms } from '../tasks/post-search';

export interface ConversationSummaryDto {
  publicId: number;
  isAnonymous: boolean;
  /** The member's name; null for an anonymous conversation. */
  requesterName: string | null;
  /** Start of the first message. */
  preview: string;
  messageCount: number;
  createdAt: string;
  lastActivityAt: string;
  /** The last message is the member's: no officer has answered it yet. */
  awaitingReply: boolean;
  locked: boolean;
}

export interface ConversationMessageDto {
  id: string;
  author: 'USER' | 'OFFICER';
  /** The member's name, only if the conversation is not anonymous; the officer's name for replies. */
  authorName: string | null;
  officerDiscordId: string | null;
  content: string;
  createdAt: string;
  /** Officer replies: whether the DM reached the member. */
  dmDelivered: boolean | null;
  /** The message has a picture, served by the image route of the conversation. */
  hasImage: boolean;
}

export interface ConversationDto {
  publicId: number;
  isAnonymous: boolean;
  /** Set only when the conversation is not anonymous. */
  requester: { name: string; discordId: string } | null;
  createdAt: string;
  locked: boolean;
  messages: ConversationMessageDto[];
}

export interface ConversationPageDto {
  items: ConversationSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
}

const PREVIEW_LENGTH = 140;

/**
 * What the backoffice may show of a conversation. The member's Discord id is only ever included
 * when the conversation is not anonymous, so an anonymous member can't be identified from here.
 */
export function toConversationDto(
  conversation: OfficerConversation,
  messages: (OfficerMessage & { attachment?: { id: string } | null })[],
): ConversationDto {
  const named = !conversation.isAnonymous;
  return {
    publicId: conversation.publicId,
    isAnonymous: conversation.isAnonymous,
    requester:
      named && conversation.userName
        ? { name: conversation.userName, discordId: conversation.userDiscordId }
        : null,
    createdAt: conversation.createdAt.toISOString(),
    locked: conversation.lockedAt !== null,
    messages: messages.map((message) => ({
      id: message.id,
      author: message.author,
      authorName:
        message.author === 'OFFICER' ? message.officerName : named ? conversation.userName : null,
      officerDiscordId: message.author === 'OFFICER' ? message.officerDiscordId : null,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      dmDelivered: message.author === 'OFFICER' ? message.dmDelivered : null,
      hasImage: Boolean(message.attachment),
    })),
  };
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ten conversations to a page, most recently active first. The search covers every page. */
  async list(
    guildId: string,
    options: { query?: string; page?: unknown } = {},
  ): Promise<ConversationPageDto> {
    const page = clampPage(options.page);
    // Each word must match the conversation id or the text of one of its messages.
    const terms = searchTerms(options.query);
    const where = {
      guildId,
      AND: terms.map((term) => ({
        OR: [
          ...(/^\d{1,9}$/.test(term) ? [{ publicId: Number(term) }] : []),
          { messages: { some: { content: { contains: term, mode: 'insensitive' as const } } } },
        ],
      })),
    };
    const [total, conversations] = await Promise.all([
      this.prisma.officerConversation.count({ where }),
      this.prisma.officerConversation.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { _count: { select: { messages: true } } },
      }),
    ]);

    const ids = conversations.map((conversation) => conversation.id);
    const [firsts, lasts] = await Promise.all([
      this.prisma.officerMessage.findMany({
        where: { conversationId: { in: ids } },
        orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
        distinct: ['conversationId'],
      }),
      this.prisma.officerMessage.findMany({
        where: { conversationId: { in: ids } },
        orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['conversationId'],
      }),
    ]);
    const first = new Map(firsts.map((message) => [message.conversationId, message]));
    const last = new Map(lasts.map((message) => [message.conversationId, message]));

    return {
      items: conversations.map((conversation) => ({
        publicId: conversation.publicId,
        isAnonymous: conversation.isAnonymous,
        requesterName: conversation.isAnonymous ? null : conversation.userName,
        preview: (first.get(conversation.id)?.content ?? '').slice(0, PREVIEW_LENGTH),
        messageCount: conversation._count.messages,
        createdAt: conversation.createdAt.toISOString(),
        lastActivityAt: conversation.updatedAt.toISOString(),
        awaitingReply: last.get(conversation.id)?.author === 'USER',
        locked: conversation.lockedAt !== null,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  async get(guildId: string, publicId: number): Promise<ConversationDto> {
    const conversation = await this.prisma.officerConversation.findUnique({
      where: { guildId_publicId: { guildId, publicId } },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { attachment: { select: { id: true } } },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return toConversationDto(conversation, conversation.messages);
  }

  /** The picture of one message of the conversation, or null. */
  async getImage(
    guildId: string,
    publicId: number,
    messageId: string,
  ): Promise<{ contentType: string; data: Buffer } | null> {
    const attachment = await this.prisma.officerAttachment.findFirst({
      where: { message: { id: messageId, conversation: { guildId, publicId } } },
      select: { contentType: true, data: true },
    });
    return attachment
      ? { contentType: attachment.contentType, data: Buffer.from(attachment.data) }
      : null;
  }
}
