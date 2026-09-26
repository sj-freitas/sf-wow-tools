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
        findUnique: async () => ({ player: { guild: { gameVersion } } }),
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
