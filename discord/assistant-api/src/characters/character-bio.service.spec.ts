import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import { CharacterBioService, MAX_BIO_LENGTH } from './character-bio.service';

const OWNER = 'owner-1';
const OTHER = 'other-1';

describe('CharacterBioService', () => {
  let gameVersion: string;
  let region: string;
  let realm: string;
  let character: {
    id: string;
    firstName: string;
    lastName: string;
    class: string;
    race: string;
    level: number;
    roles: ('TANK' | 'HEALER')[];
    isMain: boolean;
    bio: string;
    bioVisible: boolean;
    discordUserId: string;
    gameVersion: string;
    region: string;
    realm: string;
  } | null;
  let updates: Record<string, unknown>[];
  let service: CharacterBioService;

  beforeEach(() => {
    gameVersion = 'Forever';
    region = 'EU';
    realm = 'RP'; // an RP-rule-set server: bios are on.
    character = {
      id: 'c1',
      firstName: 'Merric',
      lastName: 'Stone',
      class: 'Warrior',
      race: 'Human',
      level: 60,
      roles: ['TANK'],
      isMain: true,
      bio: 'A quiet blacksmith.',
      bioVisible: false,
      discordUserId: OWNER,
      gameVersion,
      region,
      realm,
    };
    updates = [];
    const prisma = {
      character: {
        findFirst: async (args: any) => {
          if (!character) return null;
          const matches =
            character.gameVersion === args.where.gameVersion &&
            character.region === args.where.region &&
            character.realm === args.where.realm &&
            character.firstName.toLowerCase() === args.where.firstName.equals.toLowerCase() &&
            character.lastName.toLowerCase() === args.where.lastName.equals.toLowerCase();
          if (!matches) return null;
          return {
            id: character.id,
            firstName: character.firstName,
            lastName: character.lastName,
            class: character.class,
            race: character.race,
            level: character.level,
            roles: character.roles,
            isMain: character.isMain,
            bio: character.bio,
            bioVisible: character.bioVisible,
            images: [],
            player: { discordUserId: character.discordUserId },
          };
        },
        findUnique: async (args: any) => {
          if (!character || args.where.id !== character.id) return null;
          return {
            gameVersion: character.gameVersion,
            region: character.region,
            realm: character.realm,
            player: { discordUserId: character.discordUserId },
          };
        },
        update: async (args: any) => {
          updates.push(args.data);
          if (character) Object.assign(character, args.data);
          return {};
        },
      },
    } as unknown as PrismaService;
    service = new CharacterBioService(prisma);
  });

  describe('finding a character’s page', () => {
    const base = {
      characterId: 'c1',
      name: 'Merric Stone',
      class: 'Warrior',
      race: 'Human',
      level: 60,
      roles: ['Tank'],
      isMain: true,
      bioSupported: true,
    };

    it('finds a character by server and Name-Lastname, splitting on the first dash', async () => {
      const result = await service.findProfile('forever', 'eu', 'rp', 'Merric-Stone', OTHER);
      assert.deepEqual(result, {
        ...base,
        isOwner: false,
        bioVisible: false,
        bio: null, // not visible, and the viewer is not the owner
        images: [],
      });
    });

    it('resolves the server case-insensitively', async () => {
      const result = await service.findProfile('FOREVER', 'EU', 'RP', 'merric-STONE', OTHER);
      assert.notEqual(result, 'not-found');
    });

    it('shows the bio to its own player even when not visible', async () => {
      const result = await service.findProfile('forever', 'eu', 'rp', 'Merric-Stone', OWNER);
      assert.deepEqual(result, {
        ...base,
        isOwner: true,
        bioVisible: false,
        bio: 'A quiet blacksmith.',
        images: [],
      });
    });

    it('shows the bio to anyone once it is visible', async () => {
      character!.bioVisible = true;
      const result = await service.findProfile('forever', 'eu', 'rp', 'Merric-Stone', OTHER);
      assert.deepEqual(result, {
        ...base,
        isOwner: false,
        bioVisible: true,
        bio: 'A quiet blacksmith.',
        images: [],
      });
    });

    it('is "not-found" for a character that does not exist', async () => {
      assert.equal(await service.findProfile('forever', 'eu', 'rp', 'Nobody', OTHER), 'not-found');
    });

    it('is "not-found" for a server that does not exist', async () => {
      assert.equal(
        await service.findProfile('retail', 'eu', 'rp', 'Merric-Stone', OWNER),
        'not-found',
      );
    });

    it('always shows class/race/level, but hides the bio off an RP server, even to the owner', async () => {
      realm = 'PVE';
      character!.realm = 'PVE';
      character!.bioVisible = true;
      const result = await service.findProfile('forever', 'eu', 'pve', 'Merric-Stone', OWNER);
      assert.deepEqual(result, {
        ...base,
        bioSupported: false,
        isOwner: true,
        bioVisible: false,
        bio: null,
        images: [],
      });
    });

    it('splits only on the first dash (a last name never has one, but just in case)', async () => {
      character!.lastName = 'Von-Stone';
      const result = await service.findProfile('forever', 'eu', 'rp', 'Merric-Von-Stone', OWNER);
      assert.notEqual(result, 'not-found');
    });
  });

  describe('writing a bio', () => {
    it('lets the character’s own player set the text and visibility', async () => {
      const result = await service.updateBio('c1', OWNER, { bio: 'New text', bioVisible: true });
      assert.equal(result, 'updated');
      assert.deepEqual(updates[0], { bio: 'New text', bioVisible: true });
    });

    it('refuses anyone else, including an Officer (there is no such override here)', async () => {
      assert.equal(await service.updateBio('c1', OTHER, { bio: 'Hijacked' }), 'forbidden');
      assert.equal(updates.length, 0);
    });

    it('is "not-found" for an unknown character', async () => {
      assert.equal(await service.updateBio('nope', OWNER, { bio: 'x' }), 'not-found');
    });

    it('is "not-supported" off an RP server, even to the owner', async () => {
      realm = 'PVE';
      character!.realm = 'PVE';
      assert.equal(await service.updateBio('c1', OWNER, { bio: 'x' }), 'not-supported');
    });

    it('refuses a bio over the length limit', async () => {
      await assert.rejects(
        service.updateBio('c1', OWNER, { bio: 'x'.repeat(MAX_BIO_LENGTH + 1) }),
        /20000 characters/,
      );
      assert.equal(updates.length, 0);
    });

    it('allows setting only the visibility, leaving the text untouched', async () => {
      await service.updateBio('c1', OWNER, { bioVisible: true });
      assert.deepEqual(updates[0], { bioVisible: true });
    });
  });
});
