import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DiscordOAuthService } from '../auth/discord-oauth.service';
import type { PrismaService } from '../database/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { CharactersService } from './characters.service';

const owner = { discordServerId: 's', discordUserId: 'u' };
const newCharacter = {
  firstName: 'Arthas',
  lastName: 'Menethil',
  class: 'Paladin',
  race: 'Human',
  roles: ['TANK' as const],
  isMain: false,
};

describe('CharactersService last name rule', () => {
  let gameVersion: string;
  let faction: string;
  let characterRace: string;
  let characterClass: string;
  let characterFaction: string;
  let created: any[];
  let updated: any[];
  let upserts: any[];
  let removedPlayers: string[];
  let charactersLeft: number;
  let service: CharactersService;

  beforeEach(() => {
    gameVersion = 'Forever';
    faction = 'ALLIANCE';
    characterRace = '';
    characterClass = 'Paladin';
    characterFaction = 'ALLIANCE';
    created = [];
    updated = [];
    upserts = [];
    removedPlayers = [];
    charactersLeft = 0;
    const prisma = {
      guild: {
        findFirst: async () => ({ id: 'g', gameVersion, faction, region: 'EU', realm: 'RP' }),
        findUnique: async () => ({ id: 'g', gameVersion, faction, region: 'EU', realm: 'RP' }),
      },
      player: {
        upsert: async (args: any) => {
          upserts.push(args);
          return { id: 'target-player' };
        },
        deleteMany: async (args: any) => void removedPlayers.push(args.where.id),
      },
      character: {
        create: async (args: any) => {
          created.push(args.data);
          return { id: 'new-char' };
        },
        findUnique: async () => ({
          class: characterClass,
          race: characterRace,
          faction: characterFaction,
          roles: ['TANK'],
          gameVersion,
          playerId: 'old-player',
          player: { discordUserId: 'old-user' },
        }),
        count: async () => charactersLeft,
        update: async (args: any) => void updated.push(args.data),
      },
      characterGuildMembership: {
        create: async () => undefined,
        findMany: async () => [{ guildId: 'g' }],
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

    it('rejects a race the guild’s faction does not have, and stores nothing', async () => {
      // Orc is a Horde race; this guild is Alliance.
      assert.equal(await service.add(owner, { ...newCharacter, race: 'Orc' }), 'unknown-race');
      assert.equal(created.length, 0);
    });

    it('rejects a race that cannot be the chosen class, and accepts one that can', async () => {
      // A Gnome (Alliance) can be Mage, Rogue, Warlock, Warrior or Priest, not a Paladin.
      assert.equal(
        await service.add(owner, { ...newCharacter, race: 'Gnome' }),
        'race-not-for-class',
      );
      assert.equal(created.length, 0);
      assert.equal(
        await service.add(owner, { ...newCharacter, race: 'Gnome', class: 'Warrior' }),
        'created',
      );
    });

    it('does not check an empty race (a CHECK on the table refuses it; this is just a fallback)', async () => {
      assert.equal(await service.add(owner, { ...newCharacter, race: '' }), 'created');
      assert.equal(created[0].race, '');
    });

    it('does not restrict the race for a game version we know nothing about', async () => {
      gameVersion = 'Other';
      assert.equal(await service.add(owner, { ...newCharacter, race: 'Orc' }), 'created');
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

    it('checks the current class when the race changes, and a new class with the new race', async () => {
      characterRace = 'Human';
      // Human can be Paladin but not Mage; Gnome (set below) can be Mage.
      await assert.rejects(
        service.update('c', { race: 'Gnome' }),
        /A Gnome in Forever can be Mage, Rogue, Warlock, Warrior, Priest, not Paladin/,
      );
      await service.update('c', { race: 'Gnome', class: 'Mage', roles: ['RANGED_DPS'] });
      assert.equal(updated.at(-1).race, 'Gnome');
    });

    it('rejects a race the character’s (stored) faction does not have, even one of another faction, unless the faction changes too', async () => {
      await assert.rejects(
        service.update('c', { race: 'Bard' }),
        /Forever has no Bard race for that faction/,
      );
      // Orc is a Horde race; this character's stored faction is Alliance.
      await assert.rejects(
        service.update('c', { race: 'Orc' }),
        /Forever has no Orc race for that faction/,
      );
      // A deliberate faction change alongside it lets it through.
      await service.update('c', { race: 'Orc', faction: 'HORDE', class: 'Warrior' });
      assert.deepEqual(updated.at(-1), { race: 'Orc', faction: 'HORDE', class: 'Warrior' });
    });

    it('lets a faction change through when the current race fits both (Skyborne, like Pandaren)', async () => {
      characterRace = 'Skyborne';
      characterClass = 'Warrior'; // the one role Skyborne can play on both sides.
      await service.update('c', { faction: 'HORDE' });
      assert.deepEqual(updated.at(-1), { faction: 'HORDE' });
    });

    it('rejects a faction change when the current race does not exist on the other side', async () => {
      characterRace = 'Human'; // Alliance-only; this character's faction is already Alliance.
      await assert.rejects(
        service.update('c', { faction: 'HORDE' }),
        /Forever has no Human race for that faction/,
      );
    });

    describe('moving a character to another Discord user', () => {
      const names = { username: 'them', displayName: 'Them' };

      it('points the character at the other user’s (global) player, creating it with their names', async () => {
        await service.update('c', { level: 60 }, { discordUserId: 'new-user', names });
        assert.deepEqual(upserts[0].where, { discordUserId: 'new-user' });
        assert.deepEqual(upserts[0].create, {
          discordUserId: 'new-user',
          discordUsername: 'them',
          discordDisplayName: 'Them',
        });
        assert.deepEqual(updated.at(-1), { level: 60, playerId: 'target-player' });
      });

      it('removes the previous player when it is left with no characters, and only then', async () => {
        charactersLeft = 0;
        await service.update('c', {}, { discordUserId: 'new-user', names });
        assert.deepEqual(removedPlayers, ['old-player']);
        removedPlayers.length = 0;
        charactersLeft = 2;
        await service.update('c', {}, { discordUserId: 'new-user', names });
        assert.deepEqual(removedPlayers, []);
      });

      it('does nothing about the owner when it is the same user', async () => {
        await service.update('c', { level: 60 }, { discordUserId: 'old-user', names });
        assert.deepEqual(updated.at(-1), { level: 60 });
        assert.deepEqual([upserts, removedPlayers], [[], []]);
      });
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

describe('CharactersService, a character in more than one guild', () => {
  let guild: { gameVersion: string; faction: string; region: string; realm: string } | null;
  let characters: Record<
    string,
    {
      gameVersion: string;
      region: string;
      realm: string;
      race: string;
      faction: string;
      playerId: string;
      discordUserId: string;
    }
  >;
  let memberships: { characterId: string; guildId: string }[];
  let removedMemberships: { characterId: string; guildId: string }[];
  let players: Record<string, { id: string }>;
  let published: string[];
  let service: CharactersService;

  beforeEach(() => {
    guild = { gameVersion: 'Forever', faction: 'ALLIANCE', region: 'EU', realm: 'RP' };
    characters = {
      c1: {
        gameVersion: 'Forever',
        region: 'EU',
        realm: 'RP',
        race: 'Human',
        faction: 'ALLIANCE',
        playerId: 'p1',
        discordUserId: 'u1',
      },
    };
    memberships = [];
    removedMemberships = [];
    players = { u1: { id: 'p1' } };
    published = [];
    const prisma = {
      guild: { findUnique: async () => guild },
      player: { findUnique: async (args: any) => players[args.where.discordUserId] ?? null },
      character: {
        findUnique: async (args: any) => {
          const c = characters[args.where.id];
          return c ? { ...c, player: { discordUserId: c.discordUserId } } : null;
        },
        findMany: async (args: any) =>
          Object.entries(characters)
            .filter(
              ([id, c]) =>
                c.playerId === args.where.playerId &&
                c.gameVersion === args.where.gameVersion &&
                c.region === args.where.region &&
                c.realm === args.where.realm &&
                c.faction === args.where.faction &&
                !memberships.some(
                  (m) => m.characterId === id && m.guildId === args.where.guilds.none.guildId,
                ),
            )
            .map(([id, c]) => ({
              id,
              firstName: 'Zed',
              lastName: '',
              class: 'Warrior',
              race: c.race,
              faction: c.faction,
              roles: ['TANK'],
              isMain: false,
              level: 60,
            })),
      },
      characterGuildMembership: {
        create: async (args: any) => {
          if (
            memberships.some(
              (m) => m.characterId === args.data.characterId && m.guildId === args.data.guildId,
            )
          ) {
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'x',
            });
          }
          memberships.push(args.data);
        },
        deleteMany: async (args: any) => {
          const before = memberships.length;
          memberships = memberships.filter(
            (m) => !(m.characterId === args.where.characterId && m.guildId === args.where.guildId),
          );
          removedMemberships.push(args.where);
          return { count: before - memberships.length };
        },
      },
    } as unknown as PrismaService;
    service = new CharactersService(
      prisma,
      { publish: (guildId: string) => void published.push(guildId) } as unknown as RealtimeService,
      {} as DiscordOAuthService,
    );
  });

  describe('migrating an existing character into another guild', () => {
    it('adds a membership, not a new character, when the server and faction match', async () => {
      assert.equal(await service.migrate('g2', 'c1', 'u1', false), 'migrated');
      assert.deepEqual(memberships, [{ characterId: 'c1', guildId: 'g2' }]);
      assert.deepEqual(published, ['g2']);
    });

    it('refuses someone else’s character unless the caller may act for anyone', async () => {
      assert.equal(await service.migrate('g2', 'c1', 'someone-else', false), 'forbidden');
      assert.equal(await service.migrate('g2', 'c1', 'someone-else', true), 'migrated');
    });

    it('refuses a character on a different server', async () => {
      characters.c1.realm = 'PVE';
      assert.equal(await service.migrate('g2', 'c1', 'u1', false), 'wrong-server');
    });

    it('refuses a character whose (stored) faction does not match the guild', async () => {
      characters.c1.faction = 'HORDE'; // this guild is Alliance.
      assert.equal(await service.migrate('g2', 'c1', 'u1', false), 'wrong-faction');
    });

    it('does not derive the faction from the race: Skyborne exists on both sides, so only the stored faction decides', async () => {
      characters.c1.race = 'Skyborne';
      characters.c1.faction = 'HORDE'; // this guild is Alliance: refused despite the shared race.
      assert.equal(await service.migrate('g2', 'c1', 'u1', false), 'wrong-faction');
      characters.c1.faction = 'ALLIANCE';
      assert.equal(await service.migrate('g2', 'c1', 'u1', false), 'migrated');
    });

    it('is "already-member" when it is already in that guild', async () => {
      memberships.push({ characterId: 'c1', guildId: 'g2' });
      assert.equal(await service.migrate('g2', 'c1', 'u1', false), 'already-member');
    });

    it('is "not-found" for an unknown character or guild', async () => {
      assert.equal(await service.migrate('g2', 'nope', 'u1', false), 'not-found');
      guild = null;
      assert.equal(await service.migrate('g2', 'c1', 'u1', false), 'no-guild');
    });
  });

  describe('listing migration candidates', () => {
    it('offers a matching character that is not already in the guild', async () => {
      const candidates = await service.migrateCandidates('g2', 'u1');
      assert.deepEqual(
        candidates.map((c) => c.id),
        ['c1'],
      );
    });

    it('leaves out a character already in the guild', async () => {
      memberships.push({ characterId: 'c1', guildId: 'g2' });
      assert.deepEqual(await service.migrateCandidates('g2', 'u1'), []);
    });

    it('leaves out a character whose (stored) faction does not match', async () => {
      characters.c1.faction = 'HORDE';
      assert.deepEqual(await service.migrateCandidates('g2', 'u1'), []);
    });

    it('is empty for a player or guild we do not know', async () => {
      assert.deepEqual(await service.migrateCandidates('g2', 'nobody'), []);
      guild = null;
      assert.deepEqual(await service.migrateCandidates('g2', 'u1'), []);
    });
  });

  describe('removing a character from one guild', () => {
    it('deletes the membership, not the character', async () => {
      memberships.push({ characterId: 'c1', guildId: 'g2' });
      assert.equal(await service.removeFromGuild('g2', 'c1'), 'removed');
      assert.deepEqual(memberships, []);
    });

    it('is "not-found" when it was not a member', async () => {
      assert.equal(await service.removeFromGuild('g2', 'c1'), 'not-found');
    });
  });
});
