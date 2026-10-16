import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { DiscordAPIError } from '@discordjs/rest';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import type { ClassEmojiService } from './class-emojis.service';
import { SignupEventsService, type SignupGuild } from './signup-events.service';

const GUILD: SignupGuild = {
  id: 'guild-1',
  name: 'Relic Hunters',
  gameVersion: 'Forever',
  region: 'EU',
  realm: 'RP',
  faction: 'ALLIANCE',
  officerRoleId: null,
  servers: [{ discordId: 'server-1', isMain: true }],
};
const HOUR = 60 * 60 * 1000;

describe('scheduled events', () => {
  let row: Record<string, unknown> | null;
  let posted: string[];
  let failPosting: boolean;
  let service: SignupEventsService;

  beforeEach(() => {
    row = null;
    posted = [];
    failPosting = false;
    const prisma = {
      signupEvent: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          row = {
            id: 'event-1',
            entries: [],
            lockMode: 'AUTO',
            archivedAt: null,
            messageId: null,
            publishError: null,
            ...data,
          };
          return Promise.resolve(row);
        },
        update: ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(row!, data);
          return Promise.resolve(row);
        },
        updateMany: ({
          where,
          data,
        }: {
          where: { publishAt: Date };
          data: Record<string, unknown>;
        }) => {
          if (row?.publishAt !== where.publishAt) return Promise.resolve({ count: 0 });
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        },
        findUniqueOrThrow: () => Promise.resolve({ ...row!, guild: GUILD }),
        findMany: ({ where }: { where: { publishAt: { lte: Date } } }) =>
          Promise.resolve(
            row?.publishAt && (row.publishAt as Date) <= where.publishAt.lte && !row.archivedAt
              ? [{ id: row.id, publishAt: row.publishAt, title: row.title }]
              : [],
          ),
        delete: () => Promise.resolve(row),
      },
    } as unknown as PrismaService;
    const discord = {
      sendRichMessage: (channelId: string) => {
        if (failPosting) {
          return Promise.reject(
            new DiscordAPIError(
              { code: 50013, message: 'Missing Permissions' },
              50013,
              403,
              'POST',
              '/channels',
              {},
            ),
          );
        }
        posted.push(channelId);
        return Promise.resolve('message-1');
      },
    } as unknown as DiscordBotService;
    const emojis = {
      forGame: () => Promise.resolve(() => null),
      rolesFor: () => Promise.resolve(() => null),
    } as unknown as ClassEmojiService;
    service = new SignupEventsService(prisma, discord, emojis, {
      get: () => undefined,
    } as unknown as ConfigService);
  });

  const create = (publishAt?: Date) =>
    service.create(
      GUILD,
      { discordId: 'owner', name: 'Owner' },
      {
        title: 'Naxx',
        description: '',
        startsAt: new Date(Date.now() + 48 * HOUR),
        timezone: 'Europe/Paris',
        publishAt,
      },
      { serverId: 'server-1', channelId: 'events' },
    );

  it('saves an event with a posting time to come without posting it', async () => {
    const at = new Date(Date.now() + HOUR);
    await create(at);
    assert.deepEqual(posted, []);
    assert.equal(row?.publishAt, at);
    assert.equal(row?.messageId, null);
  });

  it('posts at once without a posting time, or with one already passed', async () => {
    await create(new Date(Date.now() - HOUR));
    assert.deepEqual(posted, ['events']);
    assert.equal(row?.publishAt, null);
  });

  it('refuses a posting time after the event starts', async () => {
    await assert.rejects(create(new Date(Date.now() + 72 * HOUR)), /before the event starts/);
  });

  it('the worker posts it once its time has come, and only then', async () => {
    await create(new Date(Date.now() + HOUR));
    await service.publishDue(new Date());
    assert.deepEqual(posted, []);

    await service.publishDue(new Date(Date.now() + 2 * HOUR));
    assert.deepEqual(posted, ['events']);
    assert.equal(row?.messageId, 'message-1');
    assert.equal(row?.publishAt, null);
    assert.equal(row?.publishError, null);
  });

  it('keeps it scheduled with the reason when Discord refuses, to try again', async () => {
    await create(new Date(Date.now() + HOUR));
    failPosting = true;
    const later = new Date(Date.now() + 2 * HOUR);
    await service.publishDue(later);
    assert.match(String(row?.publishError), /missing a permission/);
    assert.ok((row?.publishAt as Date) > later, 'tried again a minute later');
    assert.equal(row?.messageId, null);
  });
});
