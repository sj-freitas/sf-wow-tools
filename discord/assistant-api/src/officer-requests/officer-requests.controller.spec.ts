import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import type { ConversationsService } from './conversations.service';
import { OfficerRequestsController } from './officer-requests.controller';
import type { OfficerRequestsService } from './officer-requests.service';

const req = { user: { id: 'u1', discordId: 'd1', displayName: 'Olga' } } as AuthenticatedRequest;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const CHANNEL = '333333333333333333';
const SERVER = '111111111111111111';

describe('OfficerRequestsController', () => {
  let officer: boolean;
  let configurer: boolean;
  let calls: unknown[][];
  let stored: { contentType: string; data: Buffer } | null;
  let controller: OfficerRequestsController;

  beforeEach(() => {
    officer = true;
    configurer = true;
    calls = [];
    stored = { contentType: 'image/png', data: PNG };
    const guildAccess = {
      assertOfficer: async () => {
        if (!officer) throw new ForbiddenException();
      },
      assertCanConfigure: async () => {
        if (!configurer) throw new ForbiddenException();
      },
    } as unknown as GuildAccessService;
    const conversations = {
      list: async (...args: unknown[]) => void calls.push(['list', ...args]),
      get: async (...args: unknown[]) => void calls.push(['get', ...args]),
      getImage: async () => stored,
    } as unknown as ConversationsService;
    const officerRequests = {
      setLocked: async (...args: unknown[]) => void calls.push(['lock', ...args]),
      deleteConversation: async (...args: unknown[]) => {
        calls.push(['delete', ...args]);
        return { notDeleted: 0 };
      },
      replyAsOfficer: async (...args: unknown[]) => {
        calls.push(['reply', ...args]);
        return { dmDelivered: true };
      },
      setChannel: async (...args: unknown[]) => void calls.push(['setChannel', ...args]),
    } as unknown as OfficerRequestsService;
    controller = new OfficerRequestsController(conversations, officerRequests, guildAccess);
  });

  it('shows the list and a conversation to Officers only', async () => {
    await controller.list(req, 'g', 'raid', '2');
    await controller.get(req, 'g', '12345678');
    assert.deepEqual(calls, [
      ['list', 'g', { query: 'raid', page: '2' }],
      ['get', 'g', 12345678],
    ]);
    officer = false;
    await assert.rejects(controller.list(req, 'g'), ForbiddenException);
    await assert.rejects(controller.get(req, 'g', '12345678'), ForbiddenException);
    assert.equal(calls.length, 2);
  });

  it('rejects ids that are not 8 digits', async () => {
    await assert.rejects(controller.get(req, 'g', 'abc'), BadRequestException);
    await assert.rejects(controller.get(req, 'g', '123'), BadRequestException);
  });

  it('lets Officers reply, as their display name, with a trimmed message', async () => {
    assert.deepEqual(await controller.reply(req, 'g', '12345678', { message: '  Hi  ' }), {
      dmDelivered: true,
    });
    assert.deepEqual(calls, [
      ['reply', 'g', 12345678, { id: 'd1', name: 'Olga' }, 'Hi', undefined],
    ]);
  });

  it('passes an attached image on to the reply, after checking it is an image', async () => {
    await controller.reply(req, 'g', '12345678', { message: 'See' }, { buffer: PNG });
    const image = calls[0][5] as { contentType: string; data: Buffer };
    assert.equal(image.contentType, 'image/png');
    assert.deepEqual(image.data, PNG);
    await assert.rejects(
      controller.reply(req, 'g', '12345678', { message: 'See' }, { buffer: Buffer.from('<svg/>') }),
      BadRequestException,
    );
    assert.equal(calls.length, 1);
  });

  it('serves a message image to Officers only, with its own type', async () => {
    const sent: { status?: number; headers?: Record<string, string>; body?: unknown } = {};
    const res: any = {
      status: (code: number) => ((sent.status = code), res),
      json: (body: unknown) => ((sent.body = body), res),
      set: (headers: Record<string, string>) => ((sent.headers = headers), res),
      send: (body: unknown) => ((sent.body = body), res),
    };
    await controller.image(req, 'g', '12345678', 'm1', res);
    assert.equal(sent.headers?.['Content-Type'], 'image/png');
    assert.equal(sent.headers?.['X-Content-Type-Options'], 'nosniff');
    stored = null;
    await controller.image(req, 'g', '12345678', 'm1', res);
    assert.equal(sent.status, 404);
    officer = false;
    await assert.rejects(controller.image(req, 'g', '12345678', 'm1', res), ForbiddenException);
  });

  it('refuses replies from non-Officers and empty, too long or malformed ones', async () => {
    await assert.rejects(
      controller.reply(req, 'g', '12345678', { message: '' }),
      BadRequestException,
    );
    await assert.rejects(
      controller.reply(req, 'g', '12345678', { message: 5 }),
      BadRequestException,
    );
    await assert.rejects(
      controller.reply(req, 'g', '12345678', { message: 'x'.repeat(3501) }),
      BadRequestException,
    );
    await assert.rejects(controller.reply(req, 'g', 'abc', { message: 'hi' }), BadRequestException);
    officer = false;
    await assert.rejects(
      controller.reply(req, 'g', '12345678', { message: 'hi' }),
      ForbiddenException,
    );
    assert.deepEqual(calls, []);
  });

  it('lets Officers lock, unlock and delete conversations', async () => {
    await controller.lock(req, 'g', '12345678', { locked: true });
    await controller.lock(req, 'g', '12345678', { locked: false });
    assert.deepEqual(await controller.remove(req, 'g', '12345678'), { notDeleted: 0 });
    assert.deepEqual(calls, [
      ['lock', 'g', 12345678, true],
      ['lock', 'g', 12345678, false],
      ['delete', 'g', 12345678],
    ]);
  });

  it('refuses everyone else locking or deleting, and bad input', async () => {
    await assert.rejects(controller.lock(req, 'g', '12345678', {}), BadRequestException);
    await assert.rejects(controller.lock(req, 'g', 'abc', { locked: true }), BadRequestException);
    await assert.rejects(controller.remove(req, 'g', '123'), BadRequestException);
    officer = false;
    await assert.rejects(
      controller.lock(req, 'g', '12345678', { locked: true }),
      ForbiddenException,
    );
    await assert.rejects(controller.remove(req, 'g', '12345678'), ForbiddenException);
    assert.deepEqual(calls, []);
  });

  it('lets whoever can configure the guild set or clear the channel', async () => {
    officer = false; // a Guild-Assistant who is not an Officer
    await controller.setChannel(req, 'g', { serverId: SERVER, channelId: CHANNEL });
    await controller.setChannel(req, 'g', { channelId: null });
    assert.deepEqual(calls, [
      ['setChannel', 'g', { serverId: SERVER, channelId: CHANNEL }],
      ['setChannel', 'g', null],
    ]);
  });

  it('refuses plain members setting the channel', async () => {
    configurer = false;
    await assert.rejects(
      controller.setChannel(req, 'g', { serverId: SERVER, channelId: CHANNEL }),
      ForbiddenException,
    );
    assert.deepEqual(calls, []);
  });

  it('validates the channel ids', async () => {
    await assert.rejects(
      controller.setChannel(req, 'g', { serverId: 'x', channelId: CHANNEL }),
      BadRequestException,
    );
    await assert.rejects(
      controller.setChannel(req, 'g', { serverId: SERVER, channelId: 5 }),
      BadRequestException,
    );
  });
});
