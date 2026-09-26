import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { DiscordOAuthService } from '../auth/discord-oauth.service';
import type { PrismaService } from '../database/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { CharactersService } from './characters.service';

const owner = { discordServerId: 's', discordUserId: 'u' };
const newCharacter = {
  firstName: 'Arthas',
  lastName: 'Menethil',
  class: 'Paladin',
  roles: ['TANK' as const],
  isMain: false,
};

describe('CharactersService last name rule', () => {
  let gameVersion: string;
  let created: any[];
  let updated: any[];
  let service: CharactersService;

  beforeEach(() => {
    gameVersion = 'Forever';
    created = [];
    updated = [];
    const prisma = {
      guild: {
        findFirst: async () => ({ id: 'g', gameVersion }),
        findUnique: async () => ({ id: 'g', gameVersion }),
      },
      player: { upsert: async () => ({ id: 'p' }) },
      character: {
        create: async (args: any) => void created.push(args.data),
        findUnique: async () => ({
          class: 'Paladin',
          roles: ['TANK'],
          player: { guild: { gameVersion } },
        }),
        update: async (args: any) => {
          updated.push(args.data);
          return { player: { guildId: 'g' } };
        },
      },
    } as unknown as PrismaService;
    service = new CharactersService(
      prisma,
      { publish: () => undefined } as unknown as RealtimeService,
      {} as DiscordOAuthService,
    );
  });

  describe('adding', () => {
    it('stores a character with a last name in Forever', async () => {
      assert.equal(await service.add(owner, newCharacter), 'created');
      assert.equal(created[0].lastName, 'Menethil');
    });

    it('rejects a character without a last name in Forever, and stores nothing', async () => {
      assert.equal(
        await service.add(owner, { ...newCharacter, lastName: '' }),
        'last-name-required',
      );
      assert.equal(created.length, 0);
    });

    it('rejects a class the game version does not have, and stores nothing', async () => {
      assert.equal(await service.add(owner, { ...newCharacter, class: 'Bard' }), 'unknown-class');
      assert.equal(
        await service.addToGuild('g', 'u', { ...newCharacter, class: 'Bard' }),
        'unknown-class',
      );
      assert.equal(created.length, 0);
    });

    it('accepts any class for a game version we know nothing about', async () => {
      gameVersion = 'Other';
      assert.equal(await service.add(owner, { ...newCharacter, class: 'Bard' }), 'created');
    });

    it('rejects roles the class cannot play in the game version, and accepts the ones it can', async () => {
      // A Paladin can be Protection (Tank), Holy (Healer) or Retribution (Melee DPS), not a Ranged DPS.
      assert.equal(
        await service.add(owner, { ...newCharacter, roles: ['RANGED_DPS'] }),
        'role-not-for-class',
      );
      assert.equal(
        await service.add(owner, { ...newCharacter, roles: ['TANK', 'RANGED_DPS'] }),
        'role-not-for-class',
      );
      assert.equal(created.length, 0);
      assert.equal(
        await service.add(owner, { ...newCharacter, roles: ['HEALER', 'MELEE_DPS'] }),
        'created',
      );
    });

    it('does not restrict roles for a game version we know nothing about', async () => {
      gameVersion = 'Other';
      assert.equal(await service.add(owner, { ...newCharacter, roles: ['RANGED_DPS'] }), 'created');
    });

    it('applies to characters added from the backoffice too', async () => {
      assert.equal(
        await service.addToGuild('g', 'u', { ...newCharacter, lastName: '' }),
        'last-name-required',
      );
    });

    it('allows no last name for game versions that do not require one', async () => {
      gameVersion = 'Other';
      assert.equal(await service.add(owner, { ...newCharacter, lastName: '' }), 'created');
      assert.equal(created[0].lastName, '');
    });
  });

  describe('renaming', () => {
    it('checks the roles when they change, against the character’s class', async () => {
      await assert.rejects(
        service.update('c', { roles: ['RANGED_DPS'] }),
        /A Paladin in Forever can be Tank, Healer, Melee DPS, not Ranged DPS/,
      );
      await service.update('c', { roles: ['HEALER'] });
      assert.deepEqual(updated.at(-1).roles, ['HEALER']);
    });

    it('checks the current roles when the class changes, and the new roles with the new class', async () => {
      // The character is a Paladin Tank: as a Mage (Ranged DPS only) that Tank role no longer fits.
      await assert.rejects(
        service.update('c', { class: 'Mage' }),
        /A Mage in Forever can be Ranged DPS, not Tank/,
      );
      await service.update('c', { class: 'Mage', roles: ['RANGED_DPS'] });
      assert.equal(updated.at(-1).class, 'Mage');
    });

    it('lets a rename keep a last name', async () => {
      await service.update('c', { firstName: 'Arthas', lastName: 'Menethil' });
      assert.equal(updated.length, 1);
    });

    it('rejects a rename that removes the last name in Forever', async () => {
      await assert.rejects(
        service.update('c', { firstName: 'Arthas', lastName: '' }),
        BadRequestException,
      );
      assert.equal(updated.length, 0);
    });

    it('does not look at the name when other fields change', async () => {
      await service.update('c', { level: 60 });
      assert.equal(updated.length, 1);
    });
  });
});
