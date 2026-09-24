import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DiscordOAuthService } from '../auth/discord-oauth.service';
import type { PrismaService } from '../database/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { GuildsService } from './guilds.service';

interface Server {
  discordId: string;
  isMain: boolean;
}

describe('GuildsService', () => {
  let servers: Server[];
  let deleted: string[];
  let transactionOps: unknown[];
  let adminServers: { discordId: string; name: string }[];
  let taken: { discordId: string }[];
  let createdData: any;
  let events: string[];
  let mappingCalls: unknown[][];
  let mainServerRoles: { id: string; name: string }[];
  let service: GuildsService;

  beforeEach(() => {
    servers = [
      { discordId: 'main', isMain: true },
      { discordId: 'other', isMain: false },
    ];
    deleted = [];
    transactionOps = [];
    adminServers = [{ discordId: 'free', name: 'Free' }];
    taken = [];
    createdData = null;
    events = [];
    mappingCalls = [];
    mainServerRoles = [
      { id: 'main', name: '@everyone' },
      { id: 'r1', name: 'Raiders' },
    ];
    const prisma = {
      discordServer: {
        findMany: async (args: any) => (args?.where?.discordId ? taken : servers),
        findFirst: async (args: any) => {
          if (args.where.isMain) return { discordId: 'main' };
          return servers.find((s) => s.discordId === args.where.discordId) ? { id: 'row' } : null;
        },
        delete: async (args: any) => void deleted.push(args.where.discordId),
        updateMany: async () => 'updateMany',
        update: async () => 'update',
      },
      userAdminServer: { findMany: async () => adminServers },
      guildRoleMapping: {
        deleteMany: async (args: any) => {
          mappingCalls.push(['delete', args.where]);
          return 'deleteMappings';
        },
        upsert: async (args: any) => void mappingCalls.push(['upsert', args.create]),
      },
      guild: {
        update: async () => 'guildUpdate',
        create: async (args: any) => {
          createdData = args.data;
          return {
            id: 'g',
            servers: [],
            roleMappings: [],
            officerRoleId: null,
            officerRoleName: null,
          };
        },
      },
      $transaction: async (ops: unknown[]) => void transactionOps.push(...(await Promise.all(ops))),
    } as unknown as PrismaService;
    const realtime = {
      publish: (_g: string, type: string) => void events.push(type),
    } as unknown as RealtimeService;
    const discord = {
      fetchGuildRoles: async () => mainServerRoles,
    } as unknown as DiscordOAuthService;
    service = new GuildsService(prisma, realtime, discord);
  });

  describe('removeServer', () => {
    it('removes a non-main server and notifies', async () => {
      await service.removeServer('g', 'other');
      assert.deepEqual(deleted, ['other']);
      assert.deepEqual(events, ['guild']);
    });

    it('refuses to remove the main server', async () => {
      await assert.rejects(service.removeServer('g', 'main'), BadRequestException);
      assert.deepEqual(deleted, []);
    });

    it('refuses to remove the last server', async () => {
      servers = [{ discordId: 'main', isMain: true }];
      await assert.rejects(service.removeServer('g', 'main'), /at least one/);
      assert.deepEqual(deleted, []);
    });

    it('404s for a server that is not in the guild', async () => {
      await assert.rejects(service.removeServer('g', 'nope'), NotFoundException);
    });
  });

  describe('setMainServer', () => {
    it('switches main and clears the Officer role and role mappings in one transaction', async () => {
      await service.setMainServer('g', 'other');
      assert.deepEqual(transactionOps, ['updateMany', 'update', 'guildUpdate', 'deleteMappings']);
      assert.deepEqual(events, ['guild']);
    });

    it('rejects a server from another guild', async () => {
      await assert.rejects(service.setMainServer('g', 'nope'), NotFoundException);
      assert.deepEqual(transactionOps, []);
    });
  });

  describe('create', () => {
    const input = {
      name: 'Guild',
      realm: 'Realm',
      faction: 'ALLIANCE' as const,
      gameVersion: 'Forever',
    };

    it('creates the guild with the chosen main server and the creator as Guild-Assistant', async () => {
      await service.create('u', { ...input, discordServerIds: ['free'], mainServerId: 'free' });
      assert.deepEqual(createdData.servers.create, [
        { discordId: 'free', name: 'Free', isMain: true },
      ]);
      assert.deepEqual(createdData.access.create, { userId: 'u', isAdmin: true });
    });

    it('rejects servers the user does not hold the role in', async () => {
      await assert.rejects(
        service.create('u', { ...input, discordServerIds: ['stranger'], mainServerId: 'stranger' }),
        BadRequestException,
      );
      assert.equal(createdData, null);
    });

    it('rejects servers that already belong to a guild', async () => {
      taken = [{ discordId: 'free' }];
      await assert.rejects(
        service.create('u', { ...input, discordServerIds: ['free'], mainServerId: 'free' }),
        BadRequestException,
      );
    });

    it('rejects a main server that was not selected', async () => {
      adminServers = [
        { discordId: 'free', name: 'Free' },
        { discordId: 'free2', name: 'Free 2' },
      ];
      await assert.rejects(
        service.create('u', { ...input, discordServerIds: ['free'], mainServerId: 'free2' }),
        /main server/,
      );
    });
  });

  describe('setRoleMapping', () => {
    it('maps a role of the main server', async () => {
      await service.setRoleMapping('g', 'RAIDER', 'r1');
      assert.deepEqual(mappingCalls, [
        [
          'upsert',
          { guildId: 'g', guildRole: 'RAIDER', discordRoleId: 'r1', discordRoleName: 'Raiders' },
        ],
      ]);
      assert.deepEqual(events, ['guild']);
    });

    it('rejects a role that is not in the main server', async () => {
      await assert.rejects(service.setRoleMapping('g', 'SOCIAL', 'elsewhere'), /main server/);
      assert.deepEqual(mappingCalls, []);
    });

    it('clears the mapping with a null role and does not need Discord', async () => {
      mainServerRoles = [];
      await service.setRoleMapping('g', 'SOCIAL', null);
      assert.deepEqual(mappingCalls, [['delete', { guildId: 'g', guildRole: 'SOCIAL' }]]);
    });
  });
});
