import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { getGame } from '../game/games';
import { GuildsController } from './guilds.controller';
import type { RanksService } from './ranks.service';
import type { GuildsService } from './guilds.service';

const req = { user: { id: 'u1' } } as AuthenticatedRequest;

describe('GuildsController role mappings', () => {
  let officer: boolean;
  let member: boolean;
  let mapped: unknown[][];
  let homeWrites: unknown[][];
  let created: unknown[][];
  let blizzard: string | undefined;
  let controller: GuildsController;

  beforeEach(() => {
    officer = true;
    member = true;
    mapped = [];
    homeWrites = [];
    created = [];
    blizzard = 'set';
    const guildAccess = {
      find: async () => (member ? { isAdmin: false, isOfficer: false } : null),
      assertOfficer: async () => {
        if (!officer) throw new ForbiddenException();
      },
    } as unknown as GuildAccessService;
    const guilds = {
      create: async (...args: unknown[]) => void created.push(args),
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
        get: (key: string) => (key.startsWith('BLIZZARD') ? blizzard : undefined),
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

  describe('guild details follow the game config', () => {
    const details = {
      name: 'Relic Hunters',
      realm: 'PVE',
      faction: 'ALLIANCE',
      gameVersion: 'Forever',
      region: 'EU',
      discordServerIds: ['123456789012345678'],
    };

    it('accepts a server, faction and region the version lists', async () => {
      await controller.create(req, details);
      assert.equal(created.length, 1);
    });

    it('refuses a server the version does not list for that region', async () => {
      await assert.rejects(
        async () => controller.create(req, { ...details, realm: 'Firemaw' }),
        /must be one of RP, PVP, PVE, Hardcore for Forever in EU/,
      );
      assert.equal(created.length, 0);
    });

    it('refuses an unknown version and an unknown region', async () => {
      await assert.rejects(
        async () => controller.create(req, { ...details, gameVersion: 'Retail' }),
        /game version/,
      );
      await assert.rejects(
        async () => controller.create(req, { ...details, region: 'MARS' }),
        /region must be/,
      );
    });

    it('offers the armory test only when the Battle.net client is set up', () => {
      assert.match(controller.setupInfo().armoryTest?.description ?? '', /Wild Growth/);
    });

    it('sends the game configs to the backoffice with the setup info', () => {
      const { games } = controller.setupInfo();
      assert.equal(games[0].gameVersion, 'Forever');
      assert.deepEqual(Object.keys(games[0].factions), ['Alliance', 'Horde']);
      // Whatever the version's config says (it changes often): the API sends it as it is.
      assert.deepEqual(games[0], getGame('Forever'));
      assert.deepEqual(games[0].allowedServers.EU, ['RP', 'PVP', 'PVE', 'Hardcore']);
    });
  });
});
