import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { GuildAttributesController } from './guild-attributes.controller';
import type { GuildAttributesService } from './guild-attributes.service';

const GUILD = '0b6f3c2e-5d4a-4f1b-9c8d-7e6f5a4b3c2d';
const CHARACTER = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const req = (id: string) => ({ user: { id } }) as AuthenticatedRequest;

describe('GuildAttributesController', () => {
  let writes: string[];
  let controller: GuildAttributesController;

  beforeEach(() => {
    writes = [];
    const attributes = {
      list: () => Promise.resolve([{ id: 'a', name: 'Switcher', color: 'teal', characterIds: [] }]),
      create: () => (writes.push('create'), Promise.resolve()),
      update: () => (writes.push('update'), Promise.resolve()),
      delete: () => (writes.push('delete'), Promise.resolve()),
      setForCharacter: () => (writes.push('set'), Promise.resolve()),
    } as unknown as GuildAttributesService;
    const guildAccess = {
      // "officer" is an Officer, "member" is only in the guild, anyone else isn't in it.
      find: (userId: string) =>
        Promise.resolve(
          userId === 'stranger' ? null : { isAdmin: false, isOfficer: userId === 'officer' },
        ),
      assertOfficer: (userId: string) =>
        userId === 'officer'
          ? Promise.resolve()
          : Promise.reject(new ForbiddenException("Requires the guild's Officer role")),
    } as unknown as GuildAccessService;
    controller = new GuildAttributesController(attributes, guildAccess);
  });

  it('lets everyone in the guild see the attributes, and nobody else', async () => {
    assert.equal((await controller.list(req('member'), GUILD))[0].name, 'Switcher');
    await assert.rejects(controller.list(req('stranger'), GUILD), ForbiddenException);
  });

  it('lets only Officers create, change, delete and assign them', async () => {
    const member = req('member');
    await assert.rejects(
      controller.create(member, GUILD, { name: 'X', color: 'red' }),
      ForbiddenException,
    );
    await assert.rejects(
      controller.update(member, GUILD, 'a', { color: 'red' }),
      ForbiddenException,
    );
    await assert.rejects(controller.remove(member, GUILD, 'a'), ForbiddenException);
    await assert.rejects(
      controller.setForCharacter(member, GUILD, CHARACTER, { attributeIds: ['a'] }),
      ForbiddenException,
    );
    assert.deepEqual(writes, []);

    const officer = req('officer');
    await controller.create(officer, GUILD, { name: 'X', color: 'red' });
    await controller.setForCharacter(officer, GUILD, CHARACTER, { attributeIds: ['a'] });
    assert.deepEqual(writes, ['create', 'set']);
  });
});
