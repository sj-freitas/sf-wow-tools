import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { DiscordOAuthService } from '../auth/discord-oauth.service';
import type { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RanksService } from './ranks.service';

const member = (id: string, roles: string[]) => ({ nick: null, roles, user: { id } });

describe('RanksService', () => {
  let guild: any;
  let listCalls: number;
  let lookedUp: string[];
  let listing: 'ok' | 'denied';
  let realtime: RealtimeService;
  let service: RanksService;

  beforeEach(() => {
    guild = {
      officerRoleId: 'officer',
      roleMappings: [
        { guildRole: 'RAIDER', discordRoleId: 'raider' },
        { guildRole: 'SOCIAL', discordRoleId: 'social' },
      ],
      servers: [{ discordId: 'main' }],
      players: [{ discordUserId: 'a' }, { discordUserId: 'b' }, { discordUserId: 'c' }],
    };
    listCalls = 0;
    lookedUp = [];
    listing = 'ok';
    const prisma = { guild: { findUnique: async () => guild } } as unknown as PrismaService;
    const discord = {
      fetchServerMembers: async () => {
        listCalls++;
        if (listing === 'denied') throw new Error('Missing Access');
        return [
          member('a', ['officer', 'raider']),
          member('b', ['social']),
          member('c', ['nothing']),
          member('stranger', ['officer']),
        ];
      },
      fetchServerMember: async (_server: string, id: string) => {
        lookedUp.push(id);
        return id === 'a' ? member('a', ['raider']) : Promise.reject(new Error('Unknown Member'));
      },
    } as unknown as DiscordOAuthService;
    realtime = new RealtimeService();
    service = new RanksService(prisma, discord, realtime);
  });

  it('gives each player the ranks their Discord roles map to', async () => {
    const ranks = await service.findRanks('g');
    assert.deepEqual(ranks, { a: ['Officer', 'Raider'], b: ['Social'] });
  });

  it('leaves out players without a rank', async () => {
    assert.equal('c' in (await service.findRanks('g')), false);
  });

  it('does not call Discord when no roles are mapped', async () => {
    guild.officerRoleId = null;
    guild.roleMappings = [];
    assert.deepEqual(await service.findRanks('g'), {});
    assert.equal(listCalls, 0);
  });

  it('returns nothing for an unknown guild', async () => {
    guild = null;
    assert.deepEqual(await service.findRanks('g'), {});
  });

  it('looks players up one by one when Discord will not list members', async () => {
    listing = 'denied';
    const ranks = await service.findRanks('g');
    assert.deepEqual(lookedUp.sort(), ['a', 'b', 'c']);
    assert.deepEqual(ranks, { a: ['Raider'] });
  });

  it('reuses the result for a short while instead of calling Discord again', async () => {
    await service.findRanks('g');
    await service.findRanks('g');
    assert.equal(listCalls, 1);
  });

  it('keeps separate results per guild', async () => {
    await service.findRanks('g1');
    await service.findRanks('g2');
    assert.equal(listCalls, 2);
  });

  it('drops the cached ranks when the guild changes (roles, servers)', async () => {
    await service.findRanks('g');
    realtime.publish('g', 'guild');
    await service.findRanks('g');
    assert.equal(listCalls, 2);
  });

  it('keeps the cache when only characters change', async () => {
    await service.findRanks('g');
    realtime.publish('g', 'characters');
    await service.findRanks('g');
    assert.equal(listCalls, 1);
  });
});
