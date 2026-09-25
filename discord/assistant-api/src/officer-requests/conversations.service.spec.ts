import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import { ConversationsService, toConversationDto } from './conversations.service';

const at = (iso: string) => new Date(iso);
const USER_ID = '999888777666555444';

const conversation = (over: Record<string, unknown> = {}): any => ({
  id: 'c1',
  guildId: 'g',
  publicId: 12345678,
  isAnonymous: true,
  userDiscordId: USER_ID,
  userName: null,
  createdAt: at('2026-10-01T10:00:00Z'),
  updatedAt: at('2026-10-01T12:00:00Z'),
  ...over,
});
const message = (over: Record<string, unknown>): any => ({
  id: 'm',
  conversationId: 'c1',
  author: 'USER',
  officerDiscordId: null,
  officerName: null,
  content: 'hello',
  dmDelivered: null,
  createdAt: at('2026-10-01T10:00:00Z'),
  ...over,
});

describe('toConversationDto (what the backoffice may show)', () => {
  const messages = [
    message({ id: 'm1', author: 'USER', content: 'I have a problem' }),
    message({
      id: 'm2',
      author: 'OFFICER',
      officerDiscordId: 'o1',
      officerName: 'Olga',
      content: 'Tell me more',
      dmDelivered: true,
    }),
  ];

  it('tells the backoffice which messages have a picture, without any file details', () => {
    const dto = toConversationDto(conversation({}), [
      { ...messages[0], attachment: { id: 'a1' } },
      messages[1],
    ]);
    assert.deepEqual(
      dto.messages.map((m) => m.hasImage),
      [true, false],
    );
    assert.doesNotMatch(JSON.stringify(dto), /a1/);
  });

  it('never reveals an anonymous member: no id, no name', () => {
    const dto = toConversationDto(conversation({ userName: 'Should not leak' }), messages);
    const json = JSON.stringify(dto);
    assert.equal(dto.requester, null);
    assert.equal(dto.messages[0].authorName, null);
    assert.ok(!json.includes(USER_ID), 'the member id must not appear anywhere');
    assert.ok(!json.includes('Should not leak'), 'the member name must not appear anywhere');
  });

  it('shows the member when the conversation is not anonymous', () => {
    const dto = toConversationDto(
      conversation({ isAnonymous: false, userName: 'Merric' }),
      messages,
    );
    assert.deepEqual(dto.requester, { name: 'Merric', discordId: USER_ID });
    assert.equal(dto.messages[0].authorName, 'Merric');
  });

  it('always shows which officer replied, and whether the DM was delivered', () => {
    const dto = toConversationDto(conversation(), messages);
    assert.deepEqual(
      [
        dto.messages[1].author,
        dto.messages[1].authorName,
        dto.messages[1].officerDiscordId,
        dto.messages[1].dmDelivered,
      ],
      ['OFFICER', 'Olga', 'o1', true],
    );
    assert.equal(dto.messages[0].officerDiscordId, null);
    assert.equal(dto.messages[0].dmDelivered, null);
  });
});

describe('ConversationsService', () => {
  let conversations: any[];
  let firsts: any[];
  let lasts: any[];
  let listArgs: any;
  let service: ConversationsService;

  beforeEach(() => {
    conversations = [conversation({ _count: { messages: 3 } })];
    firsts = [message({ content: 'a'.repeat(300) })];
    lasts = [message({ author: 'USER' })];
    listArgs = null;
    const prisma = {
      officerConversation: {
        count: async () => 23,
        findMany: async (args: any) => {
          listArgs = args;
          return conversations;
        },
        findUnique: async () =>
          conversations[0] ? { ...conversations[0], messages: [message({})] } : null,
      },
      officerMessage: {
        findMany: async (args: any) => (args.orderBy[1].createdAt === 'asc' ? firsts : lasts),
      },
    } as unknown as PrismaService;
    service = new ConversationsService(prisma);
  });

  it('lists ten to a page, most recently active first', async () => {
    const page = await service.list('g', { page: '2' });
    assert.equal(listArgs.skip, 10);
    assert.equal(listArgs.take, 10);
    assert.deepEqual(listArgs.orderBy, [{ updatedAt: 'desc' }, { id: 'asc' }]);
    assert.deepEqual([page.total, page.page, page.pageSize], [23, 2, 10]);
  });

  it('summarises a conversation without identifying an anonymous member', async () => {
    const [item] = (await service.list('g')).items;
    assert.equal(item.requesterName, null);
    assert.equal(item.messageCount, 3);
    assert.equal(item.preview.length, 140);
    assert.ok(!JSON.stringify(item).includes(USER_ID));
  });

  it('flags conversations where the member wrote last', async () => {
    assert.equal((await service.list('g')).items[0].awaitingReply, true);
    lasts = [message({ author: 'OFFICER' })];
    assert.equal((await service.list('g')).items[0].awaitingReply, false);
  });

  it('searches every conversation: each word matches the id or some message text', async () => {
    await service.list('g', { query: 'raid 12345678' });
    const terms = listArgs.where.AND;
    assert.equal(terms.length, 2);
    assert.deepEqual(terms[0].OR.length, 1);
    assert.deepEqual(terms[0].OR[0].messages.some.content, {
      contains: 'raid',
      mode: 'insensitive',
    });
    assert.deepEqual(terms[1].OR[0], { publicId: 12345678 });
  });

  it('gets a conversation by its id, or 404s', async () => {
    assert.equal((await service.get('g', 12345678)).publicId, 12345678);
    conversations = [];
    await assert.rejects(service.get('g', 1), NotFoundException);
  });
});
