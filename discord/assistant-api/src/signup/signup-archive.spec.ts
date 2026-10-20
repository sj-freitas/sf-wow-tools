import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import type { ClassEmojiService } from '../discord/class-emojis.service';
import { SignupEventsService } from './signup-events.service';

/** A stored event, as far as archiving is concerned. */
interface Row {
  id: string;
  title: string;
  channelId: string;
  messageId: string | null;
  setupMessageId: string | null;
  archivedAt: Date | null;
}

describe('archiving events', () => {
  let event: Row;
  let assignmentMessages: (string | null)[];
  let deleted: string[];
  let service: SignupEventsService;

  beforeEach(() => {
    event = {
      id: 'event-1',
      title: 'Naxx',
      channelId: 'channel-1',
      messageId: 'post',
      setupMessageId: 'setup',
      archivedAt: null,
    };
    assignmentMessages = ['a1', null, 'a2'];
    deleted = [];
    const matches = (where: { id?: string; messageId?: string; archivedAt?: null }) =>
      (where.id === undefined || where.id === event.id) &&
      (where.messageId === undefined || where.messageId === event.messageId) &&
      (where.archivedAt === undefined || event.archivedAt === null);
    const prisma = {
      signupEvent: {
        updateMany: ({
          where,
          data,
        }: {
          where: { id: string; archivedAt: null };
          data: Partial<Row>;
        }) => {
          if (!matches(where)) return Promise.resolve({ count: 0 });
          Object.assign(event, data);
          return Promise.resolve({ count: 1 });
        },
        update: ({ data }: { data: Partial<Row> }) => {
          Object.assign(event, data);
          return Promise.resolve(event);
        },
        findUniqueOrThrow: () => Promise.resolve({ ...event }),
        findFirst: ({ where }: { where: { messageId: string; archivedAt: null } }) =>
          Promise.resolve(matches(where) ? { id: event.id, title: event.title } : null),
      },
      signupAssignment: {
        findMany: () =>
          Promise.resolve(
            assignmentMessages.filter((id) => id !== null).map((messageId) => ({ messageId })),
          ),
        updateMany: () => {
          assignmentMessages = assignmentMessages.map(() => null);
          return Promise.resolve({ count: 3 });
        },
      },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    } as unknown as PrismaService;
    const discord = {
      deleteMessage: (_channel: string, messageId: string) => {
        deleted.push(messageId);
        return Promise.resolve();
      },
    } as unknown as DiscordBotService;
    service = new SignupEventsService(
      prisma,
      discord,
      {} as ClassEmojiService,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  it('removes every message of the event from Discord and keeps the event, archived', async () => {
    await service.archive('event-1');
    assert.deepEqual(deleted, ['post', 'setup', 'a1', 'a2']);
    assert.ok(event.archivedAt instanceof Date);
    assert.equal(event.messageId, null);
    assert.equal(event.setupMessageId, null);
    assert.deepEqual(assignmentMessages, [null, null, null]);
  });

  it('does nothing the second time', async () => {
    await service.archive('event-1');
    deleted = [];
    await service.archive('event-1');
    assert.deepEqual(deleted, []);
  });

  it('archives the event whose post was deleted in Discord, removing its other messages', async () => {
    await service.onMessageDeleted('post');
    assert.ok(event.archivedAt instanceof Date);
    assert.deepEqual(deleted, ['post', 'setup', 'a1', 'a2']);
  });

  it('ignores other deleted messages', async () => {
    await service.onMessageDeleted('someone-elses-message');
    assert.equal(event.archivedAt, null);
    assert.deepEqual(deleted, []);
  });
});
