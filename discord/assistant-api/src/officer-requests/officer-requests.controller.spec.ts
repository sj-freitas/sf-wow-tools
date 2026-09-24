import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import type { ConversationsService } from './conversations.service';
import { OfficerRequestsController } from './officer-requests.controller';
import type { OfficerRequestsService } from './officer-requests.service';

const req = { user: { id: 'u1' } } as AuthenticatedRequest;
const CHANNEL = '333333333333333333';
const SERVER = '111111111111111111';

describe('OfficerRequestsController', () => {
  let officer: boolean;
  let configurer: boolean;
  let calls: unknown[][];
  let controller: OfficerRequestsController;

  beforeEach(() => {
    officer = true;
    configurer = true;
    calls = [];
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
    } as unknown as ConversationsService;
    const officerRequests = {
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
