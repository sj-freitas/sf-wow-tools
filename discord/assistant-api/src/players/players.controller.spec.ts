import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { PlayersController } from './players.controller';
import type { PlayersService } from './players.service';

const req = { user: { id: 'u1' } } as AuthenticatedRequest;

describe('PlayersController (a guild-scoped roster)', () => {
  let access: { isAdmin: boolean; isOfficer: boolean } | null;
  let calls: unknown[][];
  let controller: PlayersController;

  beforeEach(() => {
    access = { isAdmin: false, isOfficer: false };
    calls = [];
    const guildAccess = {
      find: async () => access,
      assertOfficer: async () => {
        if (!access?.isOfficer) throw new ForbiddenException();
      },
    } as unknown as GuildAccessService;
    const players = {
      findForGuild: async (...args: unknown[]) => (calls.push(['findForGuild', ...args]), []),
      refreshMissingNames: async (...args: unknown[]) => (calls.push(['refresh', ...args]), 3),
    } as unknown as PlayersService;
    controller = new PlayersController(players, guildAccess);
  });

  it('gives any member of the guild that guild’s players, and only that guild’s', async () => {
    await controller.findAll(req, 'guild-a');
    assert.deepEqual(calls, [['findForGuild', 'guild-a']]);
  });

  it('refuses people who are not in the guild', async () => {
    access = null;
    await assert.rejects(controller.findAll(req, 'guild-a'), ForbiddenException);
    assert.deepEqual(calls, []);
  });

  it('lets only Officers refresh names', async () => {
    await assert.rejects(controller.refreshNames(req, 'guild-a'), ForbiddenException);
    access = { isAdmin: false, isOfficer: true };
    assert.deepEqual(await controller.refreshNames(req, 'guild-a'), { updated: 3 });
    assert.deepEqual(calls, [['refresh', 'guild-a']]);
  });
});
