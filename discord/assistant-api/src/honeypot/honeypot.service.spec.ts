import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { HoneypotService } from './honeypot.service';

const SERVER = '222222222222222222';
const OTHER_SERVER = '444444444444444444';
const TRAP = '333333333333333333';
const LOG = '555555555555555555';

const testModeOf = (row: unknown): boolean => (row as { testMode: boolean }).testMode;

const validInput = {
  name: 'Trap',
  serverId: SERVER,
  channelId: TRAP,
  logServerId: SERVER,
  logChannelId: LOG,
  initialPost: 'Do not post here.',
};

describe('HoneypotService', () => {
  let officerRoleId: string | null;
  let createdRow: any;
  let duplicate: boolean;
  let createdChannels: any[];
  let posts: string[];
  let existing: any;
  let updated: any;
  let service: HoneypotService;

  beforeEach(() => {
    officerRoleId = 'officer-role';
    createdRow = null;
    duplicate = false;
    createdChannels = [];
    posts = [];
    updated = null;
    existing = {
      id: 'h1',
      guildId: 'g',
      name: 'Trap',
      enabled: true,
      testMode: true,
      discordServerId: SERVER,
      channelId: TRAP,
      logChannelId: LOG,
      createdChannel: false,
    };
    const prisma = {
      guild: { findUnique: async () => ({ officerRoleId, servers: [{ discordId: SERVER }] }) },
      honeypot: {
        create: async (args: any) => {
          if (duplicate)
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'x',
            });
          createdRow = args.data;
          return {
            id: 'h',
            enabled: true,
            createdAt: new Date(),
            ...args.data,
            discordServerId: args.data.discordServerId,
          };
        },
        findUnique: async () => existing,
        update: async (args: any) => {
          updated = args.data;
          return { ...existing, ...args.data, events: [] };
        },
      },
    } as unknown as PrismaService;
    const bot = {
      listTextChannels: async () => [
        { id: TRAP, name: 'trap' },
        { id: LOG, name: 'mod-log' },
      ],
      createTextChannel: async (_server: string, options: any) => {
        createdChannels.push(options);
        return { id: '666666666666666666', name: options.name };
      },
      postMessage: async (_channel: string, text: string) => void posts.push(text),
    } as unknown as DiscordBotService;
    service = new HoneypotService(prisma, bot);
  });

  describe('create', () => {
    it('starts in test mode by default', async () => {
      const dto = await service.create('g', 'u', validInput);
      assert.equal(createdRow.testMode, true);
      assert.equal(dto.testMode, true);
      assert.deepEqual(posts, ['Do not post here.']);
      assert.equal(createdRow.createdById, 'u');
    });

    it('needs an Officer role on the guild, so Officers are never banned', async () => {
      officerRoleId = null;
      await assert.rejects(service.create('g', 'u', validInput), /Officer role first/);
      assert.equal(createdRow, null);
    });

    it('needs explicit confirmation for live mode', async () => {
      await assert.rejects(service.create('g', 'u', { ...validInput, testMode: false }), /Confirm/);
      assert.equal(createdRow, null);
      await service.create('g', 'u', { ...validInput, testMode: false, confirmLive: true });
      assert.equal(testModeOf(createdRow), false);
    });

    it('can create the channel itself, with the topic', async () => {
      await service.create('g', 'u', {
        ...validInput,
        channelId: undefined,
        newChannelName: 'do-not-post',
        topic: 'A trap',
      });
      assert.deepEqual(createdChannels, [{ name: 'do-not-post', topic: 'A trap' }]);
      assert.equal(createdRow.createdChannel, true);
      assert.equal(createdRow.channelId, '666666666666666666');
    });

    it('rejects an empty, too long or control-character channel name', async () => {
      for (const newChannelName of ['', '   ', 'x'.repeat(101), 'line\nbreak']) {
        await assert.rejects(
          service.create('g', 'u', { ...validInput, channelId: undefined, newChannelName }),
          BadRequestException,
          JSON.stringify(newChannelName),
        );
      }
    });

    it('lets Discord decide about emojis, other alphabets, spaces and capitals', async () => {
      for (const newChannelName of [
        '🍯-honeypot',
        'do not post',
        'Ловушка',
        '🍯🐝',
        'a',
        'Do-Not-Post_1',
      ]) {
        createdChannels.length = 0;
        await service.create('g', 'u', { ...validInput, channelId: undefined, newChannelName });
        assert.equal(createdChannels[0].name, newChannelName);
      }
      // 100 characters counted as characters, not bytes: 100 emojis fit.
      await service.create('g', 'u', {
        ...validInput,
        channelId: undefined,
        newChannelName: '🍯'.repeat(100),
      });
    });

    it('rejects servers outside the guild and channels outside the server', async () => {
      await assert.rejects(
        service.create('g', 'u', { ...validInput, serverId: OTHER_SERVER }),
        /not part of this guild/,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, channelId: '999999999999999999' }),
        /not in the chosen server/,
      );
      await assert.rejects(
        service.create('g', 'u', { ...validInput, logChannelId: '999999999999999999' }),
        /log channel/,
      );
    });

    it('needs a log channel', async () => {
      await assert.rejects(
        service.create('g', 'u', { ...validInput, logChannelId: undefined }),
        BadRequestException,
      );
    });

    it('reports a channel that already is a honeypot', async () => {
      duplicate = true;
      await assert.rejects(service.create('g', 'u', validInput), ConflictException);
    });
  });

  describe('update', () => {
    it('needs confirmation to go from test mode to live', async () => {
      await assert.rejects(service.update('h1', { testMode: false }), /Confirm/);
      assert.equal(updated, null);
      await service.update('h1', { testMode: false, confirmLive: true });
      assert.equal(testModeOf(updated), false);
    });

    it('needs no confirmation to go back to test mode or to pause', async () => {
      existing.testMode = false;
      await service.update('h1', { testMode: true, enabled: false });
      assert.equal(updated.testMode, true);
      assert.equal(updated.enabled, false);
    });
  });
});
