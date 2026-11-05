import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import {
  ArmorySyncService,
  RECHECK_MS,
  armoryPatch,
  type SyncedCharacter,
} from './armory-sync.service';
import { ArmoryError, type ArmoryService } from './armory.service';

const shivan = (over: Partial<SyncedCharacter> = {}): SyncedCharacter => ({
  gameVersion: 'Forever',
  faction: 'ALLIANCE',
  race: 'Human',
  class: 'Warrior',
  level: 9,
  roles: ['TANK'],
  ...over,
});
const armory = (
  over: Partial<{ race: string; class: string; level: number; faction: string }> = {},
) => ({
  race: 'Night Elf',
  class: 'Warrior',
  level: 11,
  faction: 'Alliance',
  ...over,
});

describe('armoryPatch', () => {
  it('takes the armory’s race and level, written as the game config writes them', () => {
    assert.deepEqual(armoryPatch(shivan(), armory({ race: 'night elf' })), {
      race: 'Night Elf',
      level: 11,
    });
  });

  it('changes nothing when the character already matches', () => {
    assert.deepEqual(armoryPatch(shivan({ race: 'Night Elf', level: 11 }), armory()), {});
  });

  it('changes nothing for a character of the other faction (someone else with that name)', () => {
    assert.deepEqual(armoryPatch(shivan(), armory({ faction: 'Horde', race: 'Orc' })), {});
  });

  it('changes the class, keeping the roles the new class can play', () => {
    const patch = armoryPatch(
      shivan({ class: 'Warrior', roles: ['TANK', 'MELEE_DPS'], race: 'Night Elf', level: 11 }),
      armory({ class: 'Rogue' }),
    );
    assert.deepEqual(patch, { class: 'Rogue', roles: ['MELEE_DPS'] });
  });

  it('gives the new class its first role when none of the old ones fit', () => {
    const patch = armoryPatch(
      shivan({ class: 'Warrior', roles: ['TANK'], race: 'Night Elf', level: 11 }),
      armory({ class: 'Rogue' }),
    );
    assert.deepEqual(patch.roles, ['MELEE_DPS']);
  });

  it('leaves race and class alone when they don’t fit the game, but still takes the level', () => {
    // Night Elves can't be Paladins in Forever's config.
    assert.deepEqual(armoryPatch(shivan(), armory({ class: 'Paladin' })), { level: 11 });
    assert.deepEqual(armoryPatch(shivan(), armory({ race: 'Murloc' })), { level: 11 });
  });

  it('ignores a level that isn’t one', () => {
    assert.deepEqual(armoryPatch(shivan({ race: 'Night Elf' }), armory({ level: 0 })), {});
    assert.deepEqual(armoryPatch(shivan({ race: 'Night Elf' }), armory({ level: 1000 })), {});
  });
});

describe('ArmorySyncService', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  let rows: any[];
  let queries: any[];
  let updates: any[];
  let published: string[];
  let lookups: any[];
  let answer: (name: string) => Promise<unknown>;
  let service: ArmorySyncService;

  const row = (id: string, firstName: string, over: Record<string, unknown> = {}) => ({
    id,
    gameVersion: 'Forever',
    region: 'EU',
    faction: 'ALLIANCE',
    firstName,
    lastName: 'Darkwhisp',
    race: 'Human',
    class: 'Warrior',
    level: 9,
    roles: ['TANK'],
    guilds: [{ guildId: 'g1' }],
    ...over,
  });

  beforeEach(() => {
    rows = [row('a', 'Shivan'), row('b', 'Nobody'), row('c', 'Old', { gameVersion: 'Retail' })];
    queries = [];
    updates = [];
    published = [];
    lookups = [];
    answer = async (name) =>
      name === 'Nobody' ? Promise.reject(new ArmoryError('not-found', 'x')) : armory();
    const prisma = {
      character: {
        findMany: async (args: any) => (queries.push(args), rows),
        update: async (args: any) => void updates.push(args),
      },
    } as unknown as PrismaService;
    const armoryService = {
      configured: true,
      lookup: async (query: any, options: any) => {
        lookups.push({ query, options });
        return answer(query.name);
      },
    } as unknown as ArmoryService;
    const realtime = {
      publish: (guildId: string) => void published.push(guildId),
    } as unknown as RealtimeService;
    service = new ArmorySyncService(prisma, armoryService, realtime);
  });

  it('looks up the characters checked longest ago and updates the ones that changed', async () => {
    assert.deepEqual(await service.run(now), { checked: 3, updated: 1 });
    const [query] = queries;
    assert.deepEqual(query.where.OR[1], {
      armoryCheckedAt: { lt: new Date(now.getTime() - RECHECK_MS) },
    });
    assert.deepEqual(query.orderBy, { armoryCheckedAt: { sort: 'asc', nulls: 'first' } });
    assert.deepEqual(lookups[0], {
      query: {
        namespace: 'profile-forever-eu',
        region: 'EU',
        name: 'Shivan',
        lastName: 'Darkwhisp',
      },
      options: { talents: false },
    });
    assert.deepEqual(updates[0], {
      where: { id: 'a' },
      data: { race: 'Night Elf', level: 11, armoryCheckedAt: now },
    });
    // Not in the armory, and a version without one: only marked as checked.
    assert.deepEqual(updates[1].data, { armoryCheckedAt: now });
    assert.deepEqual(updates[2].data, { armoryCheckedAt: now });
    assert.equal(lookups.length, 2, 'the version without an armory is not asked');
    assert.deepEqual(published, ['g1'], 'open rosters reload');
  });

  it('stops the pass when Blizzard is down, leaving the rest for the next one', async () => {
    answer = async () => Promise.reject(new ArmoryError('unavailable', 'down'));
    assert.deepEqual(await service.run(now), { checked: 0, updated: 0 });
    assert.equal(lookups.length, 1);
    assert.deepEqual(updates, []);
  });

  it('never throws', async () => {
    rows = null as never;
    assert.deepEqual(await service.run(now), { checked: 0, updated: 0 });
  });
});
