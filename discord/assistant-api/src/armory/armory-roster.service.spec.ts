import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { GuildAccessService } from '../auth/guild-access.service';
import type { PrismaService } from '../database/prisma.service';
import { ArmoryRosterService } from './armory-roster.service';
import { ArmoryError, type ArmoryGuild, type ArmoryService } from './armory.service';

const member = (name: string, lastName: string, rank: number) => ({
  name,
  lastName,
  level: 20,
  class: 'Priest',
  race: 'Dwarf',
  faction: 'Alliance',
  rank,
});

const player = (discordUserId: string) => ({
  discordUserId,
  discordUsername: `user${discordUserId}`,
  discordDisplayName: null,
});

describe('ArmoryRosterService', () => {
  let access: { isAdmin: boolean; isOfficer: boolean } | null;
  let guild: { name: string; gameVersion: string; region: string; realm: string } | null;
  let asked: unknown[];
  let outcome: () => Promise<ArmoryGuild>;
  let characterQueries: { where: unknown }[];
  let service: ArmoryRosterService;

  beforeEach(() => {
    access = { isAdmin: false, isOfficer: true };
    guild = { name: 'Relic Hunters', gameVersion: 'Forever', region: 'EU', realm: 'RP' };
    asked = [];
    characterQueries = [];
    outcome = async () => ({
      name: 'Relic Hunters',
      faction: 'Alliance',
      members: [
        member('Zed', 'Zulu', 2),
        member('Jo', 'Mckenna', 4),
        member('Amy', 'Pond', 2),
        member('Gm', 'Boss', 0),
      ],
    });
    service = new ArmoryRosterService(
      {
        guildRoster: (query: unknown) => {
          asked.push(query);
          return outcome();
        },
      } as unknown as ArmoryService,
      { find: async () => access } as unknown as GuildAccessService,
      {
        guild: { findUnique: async () => guild },
        character: {
          findMany: async (query: { where: unknown }) => {
            characterQueries.push(query);
            return [
              // Another guild's (not this one's): known, addable.
              { id: 'c-amy', firstName: 'Amy', lastName: 'Pond', guilds: [], player: player('2') },
              // The same name for two players: the one on this roster wins, whatever the order.
              {
                id: 'c-jo-on-roster',
                firstName: 'Jo',
                lastName: 'McKenna',
                guilds: [{ guildId: 'g' }],
                player: player('1'),
              },
              {
                id: 'c-jo-other',
                firstName: 'Jo',
                lastName: 'Mckenna',
                guilds: [],
                player: player('3'),
              },
            ];
          },
        },
      } as unknown as PrismaService,
    );
  });

  it('lists the armory’s members by rank and name, each with the character we have by that name', async () => {
    const roster = await service.forGuild('u1', 'g');
    assert.deepEqual(asked, [
      { namespace: 'profile-forever-eu', region: 'EU', guildName: 'Relic Hunters' },
    ]);
    // Characters on the guild's server only.
    assert.deepEqual(characterQueries[0].where, {
      gameVersion: 'Forever',
      region: 'EU',
      realm: 'RP',
    });
    assert.equal(roster.name, 'Relic Hunters');
    assert.deepEqual(
      roster.members.map((m) => [m.name, m.character?.id ?? null, m.character?.inGuild ?? null]),
      [
        ['Gm', null, null],
        ['Amy', 'c-amy', false],
        ['Zed', null, null],
        // Matched whatever the case (McKenna here, Mckenna in the armory).
        ['Jo', 'c-jo-on-roster', true],
      ],
    );
    assert.deepEqual(roster.members[1].character?.player, {
      discordUserId: '2',
      username: 'user2',
      displayName: null,
    });
  });

  it('looks the guild up by another name when asked (its name in the game differs)', async () => {
    await service.forGuild('u1', 'g', '  Relic Hunterz ');
    assert.deepEqual(asked, [
      { namespace: 'profile-forever-eu', region: 'EU', guildName: 'Relic Hunterz' },
    ]);
  });

  it('is for Officers only, without asking the armory', async () => {
    access = { isAdmin: true, isOfficer: false };
    await assert.rejects(service.forGuild('u1', 'g'), ForbiddenException);
    access = null;
    await assert.rejects(service.forGuild('u1', 'g'), ForbiddenException);
    assert.deepEqual(asked, []);
  });

  it('answers 503 for a version without an armory, without asking it', async () => {
    guild = { name: 'X', gameVersion: 'Nope', region: 'EU', realm: 'RP' };
    await assert.rejects(service.forGuild('u1', 'g'), ServiceUnavailableException);
    assert.deepEqual(asked, []);
  });

  it('answers 404, 503 and 502 for not found, not set up and unavailable', async () => {
    outcome = async () => Promise.reject(new ArmoryError('not-found', 'x'));
    await assert.rejects(service.forGuild('u1', 'g'), NotFoundException);
    outcome = async () => Promise.reject(new ArmoryError('not-configured', 'x'));
    await assert.rejects(service.forGuild('u1', 'g'), ServiceUnavailableException);
    outcome = async () => Promise.reject(new ArmoryError('unavailable', 'x'));
    await assert.rejects(service.forGuild('u1', 'g'), BadGatewayException);
  });
});
