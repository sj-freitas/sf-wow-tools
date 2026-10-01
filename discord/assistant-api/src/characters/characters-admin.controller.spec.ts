import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { CharactersAdminController } from './characters-admin.controller';
import type { CharactersService } from './characters.service';

type Access = { isAdmin: boolean; isOfficer: boolean } | null;

const ME = '111111111111111111';
const OTHER = '222222222222222222';
const req = { user: { id: 'user-1', discordId: ME, username: 'me' } } as AuthenticatedRequest;
const body = { name: 'Arthas', class: 'Paladin', race: 'Human', roles: ['TANK'] };

describe('CharactersAdminController permissions', () => {
  let access: Access;
  let added: { discordUserId: string; names: unknown }[];
  let updated: string[];
  let owners: unknown[];
  let removed: string[];
  let ownerOfCharacter: string;
  let isServerMember: boolean;
  let controller: CharactersAdminController;

  beforeEach(() => {
    access = { isAdmin: false, isOfficer: false };
    added = [];
    updated = [];
    owners = [];
    removed = [];
    ownerOfCharacter = ME;
    isServerMember = true;
    const characters = {
      addToGuild: async (_guild: string, discordUserId: string, _c: unknown, names: unknown) => {
        added.push({ discordUserId, names });
        return 'created';
      },
      findGuildMemberNames: async () =>
        isServerMember ? { username: 'them', displayName: null } : null,
      findOwnership: async () => ({ guildId: 'g', discordUserId: ownerOfCharacter }),
      update: async (id: string, _patch: unknown, owner: unknown) => {
        updated.push(id);
        owners.push(owner);
      },
      removeById: async (id: string) => void removed.push(id),
    } as unknown as CharactersService;
    const guildAccess = { find: async () => access } as unknown as GuildAccessService;
    controller = new CharactersAdminController(characters, guildAccess);
  });

  describe('adding', () => {
    it('lets a member add their own character (discordUserId omitted)', async () => {
      await controller.create(req, 'g', body);
      assert.equal(added[0].discordUserId, ME);
    });

    it('lets a member name themselves explicitly', async () => {
      await controller.create(req, 'g', { ...body, discordUserId: ME });
      assert.equal(added[0].discordUserId, ME);
    });

    it('forbids a member from adding for someone else', async () => {
      await assert.rejects(
        controller.create(req, 'g', { ...body, discordUserId: OTHER }),
        ForbiddenException,
      );
      assert.equal(added.length, 0);
    });

    it('forbids people outside the guild', async () => {
      access = null;
      await assert.rejects(controller.create(req, 'g', body), ForbiddenException);
    });

    it('lets an Officer add for another member of the guild’s servers', async () => {
      access = { isAdmin: false, isOfficer: true };
      await controller.create(req, 'g', { ...body, discordUserId: OTHER });
      assert.equal(added[0].discordUserId, OTHER);
    });

    it('rejects an Officer adding someone who is in none of the servers', async () => {
      access = { isAdmin: false, isOfficer: true };
      isServerMember = false;
      await assert.rejects(
        controller.create(req, 'g', { ...body, discordUserId: OTHER }),
        BadRequestException,
      );
    });

    it('does not let a Guild-Assistant (non-Officer) add for others', async () => {
      access = { isAdmin: true, isOfficer: false };
      await assert.rejects(
        controller.create(req, 'g', { ...body, discordUserId: OTHER }),
        ForbiddenException,
      );
    });

    it('validates the name', async () => {
      await assert.rejects(
        controller.create(req, 'g', { ...body, name: 'Ar7has' }),
        BadRequestException,
      );
    });

    it('requires a race, and rejects an empty one', async () => {
      await assert.rejects(controller.create(req, 'g', { ...body, race: '' }), BadRequestException);
      const noRace: Record<string, unknown> = { ...body };
      delete noRace.race;
      await assert.rejects(controller.create(req, 'g', noRace), BadRequestException);
    });
  });

  describe('editing and removing', () => {
    it('lets a member change their own character', async () => {
      await controller.update(req, 'c1', { level: 60 });
      await controller.remove(req, 'c1');
      assert.deepEqual([updated, removed], [['c1'], ['c1']]);
    });

    it('forbids a member from changing someone else’s character', async () => {
      ownerOfCharacter = OTHER;
      await assert.rejects(controller.update(req, 'c1', { level: 60 }), ForbiddenException);
      await assert.rejects(controller.remove(req, 'c1'), ForbiddenException);
      assert.deepEqual([updated, removed], [[], []]);
    });

    it('lets an Officer change anyone’s character', async () => {
      ownerOfCharacter = OTHER;
      access = { isAdmin: false, isOfficer: true };
      await controller.update(req, 'c1', { level: 60 });
      await controller.remove(req, 'c1');
      assert.deepEqual([updated, removed], [['c1'], ['c1']]);
    });

    it('lets an Officer move a character to another Discord user of the guild', async () => {
      access = { isAdmin: false, isOfficer: true };
      await controller.update(req, 'c1', { discordUserId: OTHER });
      assert.deepEqual(owners, [
        { discordUserId: OTHER, names: { username: 'them', displayName: null } },
      ]);
    });

    it('refuses to move it to someone who is not in the guild’s servers, or to a bad id', async () => {
      access = { isAdmin: false, isOfficer: true };
      isServerMember = false;
      await assert.rejects(controller.update(req, 'c1', { discordUserId: OTHER }), /not a member/);
      await assert.rejects(
        controller.update(req, 'c1', { discordUserId: 'abc' }),
        BadRequestException,
      );
      assert.deepEqual(updated, []);
    });

    it('forbids members, even for their own character, from moving it to someone else', async () => {
      await assert.rejects(
        controller.update(req, 'c1', { discordUserId: OTHER }),
        ForbiddenException,
      );
      assert.deepEqual(updated, []);
    });

    it('does not treat sending the current owner back as a move', async () => {
      await controller.update(req, 'c1', { discordUserId: ME, level: 60 });
      assert.deepEqual(owners, [undefined]);
    });

    it('forbids a Guild-Assistant (non-Officer) from changing others’ characters', async () => {
      ownerOfCharacter = OTHER;
      access = { isAdmin: true, isOfficer: false };
      await assert.rejects(controller.update(req, 'c1', { level: 60 }), ForbiddenException);
    });

    it('forbids someone who left the guild, even for their own character', async () => {
      access = null;
      await assert.rejects(controller.remove(req, 'c1'), ForbiddenException);
    });
  });
});
