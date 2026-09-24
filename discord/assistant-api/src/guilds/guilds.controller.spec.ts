import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { GuildsController } from './guilds.controller';
import type { RanksService } from './ranks.service';
import type { GuildsService } from './guilds.service';

const req = { user: { id: 'u1' } } as AuthenticatedRequest;

describe('GuildsController role mappings', () => {
  let officer: boolean;
  let member: boolean;
  let mapped: unknown[][];
  let homeWrites: unknown[][];
  let controller: GuildsController;

  beforeEach(() => {
    officer = true;
    member = true;
    mapped = [];
    homeWrites = [];
    const guildAccess = {
      find: async () => (member ? { isAdmin: false, isOfficer: false } : null),
      assertOfficer: async () => {
        if (!officer) throw new ForbiddenException();
      },
    } as unknown as GuildAccessService;
    const guilds = {
      setRoleMapping: async (...args: unknown[]) => void mapped.push(args),
      getHome: async () => ({ markdown: null, updatedAt: null, updatedBy: null }),
      setHome: async (...args: unknown[]) => void homeWrites.push(args),
    } as unknown as GuildsService;
    controller = new GuildsController(
      guilds,
      guildAccess,
      {} as AuthService,
      { findRanks: async () => ({ a: ['Raider'] }) } as unknown as RanksService,
      {
        getOrThrow: () => 'app-id',
      } as unknown as ConfigService,
    );
  });

  it('lets an Officer set and clear the Raider and Social roles', async () => {
    await controller.setRoleMapping(req, 'g', 'RAIDER', { roleId: 'r1' });
    await controller.setRoleMapping(req, 'g', 'SOCIAL', { roleId: null });
    assert.deepEqual(mapped, [
      ['g', 'RAIDER', 'r1'],
      ['g', 'SOCIAL', null],
    ]);
  });

  it('forbids anyone who is not an Officer', async () => {
    officer = false;
    await assert.rejects(
      controller.setRoleMapping(req, 'g', 'RAIDER', { roleId: 'r1' }),
      ForbiddenException,
    );
    assert.deepEqual(mapped, []);
  });

  it('only knows the Raider and Social guild roles', async () => {
    await assert.rejects(
      controller.setRoleMapping(req, 'g', 'OFFICER', { roleId: 'r1' }),
      BadRequestException,
    );
    await assert.rejects(
      controller.setRoleMapping(req, 'g', 'raider', { roleId: 'r1' }),
      BadRequestException,
    );
  });

  it('requires a role id unless clearing', async () => {
    await assert.rejects(controller.setRoleMapping(req, 'g', 'RAIDER', {}), BadRequestException);
  });

  it('shows ranks to any member of the guild, but not to outsiders', async () => {
    assert.deepEqual(await controller.ranks(req, 'g'), { a: ['Raider'] });
    member = false;
    await assert.rejects(controller.ranks(req, 'g'), ForbiddenException);
  });

  describe('welcome post', () => {
    it('is readable by any member of the guild, but not by outsiders', async () => {
      assert.deepEqual(await controller.home(req, 'g'), {
        markdown: null,
        updatedAt: null,
        updatedBy: null,
      });
      member = false;
      await assert.rejects(controller.home(req, 'g'), ForbiddenException);
    });

    it('can only be written by Officers', async () => {
      await controller.setHome(req, 'g', { markdown: '# Hi' });
      assert.deepEqual(homeWrites, [['g', 'u1', '# Hi']]);
      officer = false;
      await assert.rejects(controller.setHome(req, 'g', { markdown: '# Hi' }), ForbiddenException);
      assert.equal(homeWrites.length, 1);
    });
  });
});
