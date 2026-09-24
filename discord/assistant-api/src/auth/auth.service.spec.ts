import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { APP_CONFIG } from '../config/app.config';
import type { PrismaService } from '../database/prisma.service';
import { AuthService } from './auth.service';
import { DiscordApiError, type DiscordOAuthService } from './discord-oauth.service';
import { TokenCrypto } from './token-crypto';

const KEY = 'test-key';
const SESSION_TOKEN = 'session-token';
const ROLE = APP_CONFIG.adminRoleName;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

interface GuildRow {
  id: string;
  officerRoleId: string | null;
  servers: { discordId: string; isMain: boolean }[];
}

describe('AuthService.refresh', () => {
  let session: any;
  let deletedSessions: string[];
  let accessRows: any[];
  let adminServerRows: any[];
  let guilds: GuildRow[];
  let userServers: { id: string; name: string }[];
  let botServers: Set<string>;
  let memberRoles: Record<string, string[]>;
  let serverRoles: Record<string, { id: string; name: string }[]>;
  let discordCalls: number;
  let failWith: Error | null;
  let service: AuthService;

  beforeEach(() => {
    session = {
      id: 's1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 86_400_000),
      discordAccessToken: new TokenCrypto(KEY).encrypt('discord-token'),
      discordTokenExpiresAt: new Date(Date.now() + 86_400_000),
      discordSyncedAt: minutesAgo(10),
    };
    deletedSessions = [];
    accessRows = [];
    adminServerRows = [];
    guilds = [];
    userServers = [];
    botServers = new Set();
    memberRoles = {};
    serverRoles = {};
    discordCalls = 0;
    failWith = null;

    const prisma = {
      session: {
        findUnique: async (args: any) =>
          args.where.tokenHash === createHash('sha256').update(SESSION_TOKEN).digest('hex')
            ? session
            : null,
        deleteMany: async (args: any) => void deletedSessions.push(args.where.id),
        update: async () => undefined,
        updateMany: async () => undefined,
      },
      user: { findUniqueOrThrow: async () => ({ discordId: 'd1', username: 'me' }) },
      guild: { findMany: async () => guilds },
      player: { updateMany: async () => undefined },
      guildAccess: {
        deleteMany: async () => undefined,
        createMany: async (args: any) => void accessRows.push(...args.data),
      },
      userAdminServer: {
        deleteMany: async () => undefined,
        createMany: async (args: any) => void adminServerRows.push(...args.data),
      },
      discordServer: { updateMany: async () => undefined },
      $transaction: async (ops: unknown[]) => Promise.all(ops),
    } as unknown as PrismaService;

    const discord = {
      fetchGuilds: async () => {
        discordCalls++;
        if (failWith) throw failWith;
        return userServers;
      },
      fetchBotGuildIds: async () => botServers,
      fetchGuildMember: async (_token: string, serverId: string) => ({
        roles: memberRoles[serverId] ?? [],
      }),
      fetchGuildRoles: async (serverId: string) => serverRoles[serverId] ?? [],
    } as unknown as DiscordOAuthService;

    service = new AuthService(prisma, discord, {
      getOrThrow: () => KEY,
    } as unknown as ConfigService);
  });

  describe('cooldown', () => {
    it('skips an ordinary refresh when the last sync is recent', async () => {
      session.discordSyncedAt = minutesAgo(1);
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(discordCalls, 0);
    });

    it('syncs an ordinary refresh when the last sync is older than 5 minutes', async () => {
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(discordCalls, 1);
    });

    it('skips a forced refresh within the cooldown so it cannot hammer Discord', async () => {
      session.discordSyncedAt = new Date(Date.now() - 5_000);
      await service.refresh(SESSION_TOKEN, { force: true });
      assert.equal(discordCalls, 0);
    });

    it('runs a forced refresh once the cooldown has passed', async () => {
      session.discordSyncedAt = minutesAgo(1);
      await service.refresh(SESSION_TOKEN, { force: true });
      assert.equal(discordCalls, 1);
    });
  });

  describe('access computation', () => {
    beforeEach(() => {
      userServers = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ];
      botServers = new Set(['a', 'b']);
      serverRoles = {
        a: [{ id: 'ra', name: ROLE }],
        b: [{ id: 'rb', name: ROLE }],
      };
    });

    const accessOf = (guildId: string) => accessRows.find((row) => row.guildId === guildId);

    it('makes the user Guild-Assistant only if they hold the role in every server of the guild', async () => {
      guilds = [
        {
          id: 'both',
          officerRoleId: null,
          servers: [
            { discordId: 'a', isMain: true },
            { discordId: 'b', isMain: false },
          ],
        },
      ];
      memberRoles = { a: ['ra'], b: [] };
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(accessOf('both').isAdmin, false);

      accessRows = [];
      session.discordSyncedAt = minutesAgo(10);
      memberRoles = { a: ['ra'], b: ['rb'] };
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(accessOf('both').isAdmin, true);
    });

    it('does not count a server the bot is not in', async () => {
      botServers = new Set(['a']);
      guilds = [
        {
          id: 'both',
          officerRoleId: null,
          servers: [
            { discordId: 'a', isMain: true },
            { discordId: 'b', isMain: false },
          ],
        },
      ];
      memberRoles = { a: ['ra'], b: ['rb'] };
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(accessOf('both').isAdmin, false);
    });

    it('finds the role even when the server has several roles with that name', async () => {
      serverRoles = {
        a: [
          { id: 'first', name: ROLE },
          { id: 'second', name: ROLE },
        ],
        b: [],
      };
      guilds = [{ id: 'g', officerRoleId: null, servers: [{ discordId: 'a', isMain: true }] }];
      memberRoles = { a: ['second'] };
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(accessOf('g').isAdmin, true);
    });

    it('gives members of a guild access without any role', async () => {
      guilds = [{ id: 'g', officerRoleId: null, servers: [{ discordId: 'a', isMain: true }] }];
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.deepEqual(accessOf('g'), {
        userId: 'u1',
        guildId: 'g',
        isAdmin: false,
        isOfficer: false,
      });
    });

    it('makes the user an Officer when they hold the Officer role in the main server', async () => {
      guilds = [
        {
          id: 'g',
          officerRoleId: 'officer',
          servers: [
            { discordId: 'a', isMain: false },
            { discordId: 'b', isMain: true },
          ],
        },
      ];
      memberRoles = { b: ['officer'] };
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(accessOf('g').isOfficer, true);
    });

    it('ignores the Officer role held in a non-main server', async () => {
      guilds = [
        {
          id: 'g',
          officerRoleId: 'officer',
          servers: [
            { discordId: 'a', isMain: false },
            { discordId: 'b', isMain: true },
          ],
        },
      ];
      memberRoles = { a: ['officer'], b: [] };
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(accessOf('g').isOfficer, false);
    });

    it('lists servers where the user holds the role as eligible admin servers', async () => {
      memberRoles = { a: ['ra'], b: [] };
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.deepEqual(adminServerRows, [{ userId: 'u1', discordId: 'a', name: 'A' }]);
    });
  });

  describe('expired or rejected Discord authorization', () => {
    it('ends the session and asks for a new login when the stored token has expired', async () => {
      session.discordTokenExpiresAt = minutesAgo(1);
      await assert.rejects(service.refresh(SESSION_TOKEN, { force: false }), UnauthorizedException);
      assert.deepEqual(deletedSessions, ['s1']);
      assert.equal(discordCalls, 0);
    });

    it('ends the session for sessions that have no stored token', async () => {
      session.discordAccessToken = null;
      await assert.rejects(service.refresh(SESSION_TOKEN, { force: false }), UnauthorizedException);
      assert.deepEqual(deletedSessions, ['s1']);
    });

    it('ends the session when Discord rejects the token (401)', async () => {
      failWith = new DiscordApiError(401, 'nope');
      await assert.rejects(service.refresh(SESSION_TOKEN, { force: false }), UnauthorizedException);
      assert.deepEqual(deletedSessions, ['s1']);
    });

    it('keeps the session on other Discord failures', async () => {
      failWith = new DiscordApiError(500, 'boom');
      await assert.rejects(service.refresh(SESSION_TOKEN, { force: false }), BadGatewayException);
      assert.deepEqual(deletedSessions, []);
    });

    it('refreshIfStale swallows temporary Discord failures but rethrows a dead session', async () => {
      failWith = new DiscordApiError(500, 'boom');
      await service.refreshIfStale(SESSION_TOKEN);

      failWith = new DiscordApiError(401, 'nope');
      await assert.rejects(service.refreshIfStale(SESSION_TOKEN), UnauthorizedException);
    });

    it('rejects sessions that do not exist', async () => {
      await assert.rejects(service.refresh('unknown', { force: false }), UnauthorizedException);
    });
  });
});
