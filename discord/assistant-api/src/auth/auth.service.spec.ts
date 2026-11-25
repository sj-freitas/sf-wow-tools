import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { BadGatewayException, Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { APP_CONFIG } from '../config/app.config';
import type { PrismaService } from '../database/prisma.service';
import { AuthService, describeError } from './auth.service';
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
  let userServers: { id: string; name: string; icon?: string | null }[];
  let botServers: Set<string>;
  let memberRoles: Record<string, string[]>;
  let serverRoles: Record<string, { id: string; name: string }[]>;
  let discordCalls: number;
  let failWith: Error | null;
  let memberFailsWith: number | null;
  let memberLookups: string[];
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
    memberFailsWith = null;
    memberLookups = [];

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
      fetchGuildMember: async (_token: string, serverId: string) => {
        memberLookups.push(serverId);
        if (memberFailsWith) throw new DiscordApiError(memberFailsWith, 'member lookup failed');
        return { roles: memberRoles[serverId] ?? [] };
      },
      fetchGuildRoles: async (serverId: string) => serverRoles[serverId] ?? [],
    } as unknown as DiscordOAuthService;

    service = new AuthService(prisma, discord, {
      getOrThrow: () => KEY,
    } as unknown as ConfigService);
  });

  describe('cooldown', () => {
    it('skips an ordinary refresh when the last sync is recent', async () => {
      session.discordSyncedAt = new Date(Date.now() - 20_000);
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(discordCalls, 0);
    });

    it('syncs an ordinary refresh when the last sync is older than a minute', async () => {
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(discordCalls, 1);
    });

    it('skips a forced refresh within the cooldown so it cannot hammer Discord', async () => {
      session.discordSyncedAt = new Date(Date.now() - 5_000);
      await service.refresh(SESSION_TOKEN, { force: true });
      assert.equal(discordCalls, 0);
    });

    it('runs a forced refresh once the cooldown has passed', async () => {
      session.discordSyncedAt = minutesAgo(2);
      await service.refresh(SESSION_TOKEN, { force: true });
      assert.equal(discordCalls, 1);
    });
  });

  describe('access computation', () => {
    beforeEach(() => {
      userServers = [
        { id: 'a', name: 'A', icon: 'a-icon' },
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

    it('keeps the access the user already had when Discord fails, instead of wiping it', async () => {
      guilds = [{ id: 'g', officerRoleId: null, servers: [{ discordId: 'a', isMain: true }] }];
      accessRows = [{ userId: 'u1', guildId: 'g', isAdmin: true, isOfficer: true }];
      memberFailsWith = 500;
      await assert.rejects(service.refresh(SESSION_TOKEN, { force: false }), BadGatewayException);
      assert.deepEqual(accessRows, [
        { userId: 'u1', guildId: 'g', isAdmin: true, isOfficer: true },
      ]);
    });

    it('reads a member record once per server, however many times a sync wants it', async () => {
      guilds = [{ id: 'g', officerRoleId: 'officer', servers: [{ discordId: 'a', isMain: true }] }];
      memberRoles = { a: ['ra', 'officer'], b: [] };
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(accessOf('g').isAdmin, true);
      assert.equal(accessOf('g').isOfficer, true);
      // Server 'a' is asked about twice over a sync (admin role, then officer role in the guild's
      // main server). Discord allows about one such request a second, so the second one came back
      // 429 and failed the whole sync.
      assert.deepEqual([...memberLookups].sort(), ['a', 'b']);
    });

    it('treats "not a member of that server" as holding no role', async () => {
      guilds = [{ id: 'g', officerRoleId: null, servers: [{ discordId: 'a', isMain: true }] }];
      memberFailsWith = 404;
      await service.refresh(SESSION_TOKEN, { force: false });
      assert.equal(accessOf('g').isAdmin, false);
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
      assert.deepEqual(adminServerRows, [
        { userId: 'u1', discordId: 'a', name: 'A', icon: 'a-icon' },
      ]);
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

    it('answers with the same message but keeps what Discord said as the cause', async () => {
      const discordFailure = new DiscordApiError(429, 'Discord request /users/@me/guilds failed');
      failWith = discordFailure;
      await assert.rejects(service.refresh(SESSION_TOKEN, { force: false }), (error: unknown) => {
        assert.ok(error instanceof BadGatewayException);
        assert.equal(error.message, 'Could not reach Discord. Try again in a moment.');
        assert.deepEqual(error.getResponse(), {
          message: 'Could not reach Discord. Try again in a moment.',
          error: 'Bad Gateway',
          statusCode: 502,
        });
        assert.equal(error.cause, discordFailure);
        return true;
      });
    });

    it('logs what Discord answered, not just that it was unreachable', async () => {
      failWith = new DiscordApiError(429, 'Discord request /users/@me/guilds failed (429)');
      const warnings: string[] = [];
      const warn = mock.method(Logger.prototype, 'warn', (message: unknown) => {
        warnings.push(String(message));
      });
      try {
        await service.refreshIfStale(SESSION_TOKEN);
      } finally {
        warn.mock.restore();
      }
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /Discord request \/users\/@me\/guilds failed \(429\)/);
    });

    it('refreshIfStale swallows a temporary Discord failure', async () => {
      failWith = new DiscordApiError(500, 'boom');
      await service.refreshIfStale(SESSION_TOKEN);
    });

    it('refreshIfStale rethrows a dead session', async () => {
      failWith = new DiscordApiError(401, 'nope');
      await assert.rejects(service.refreshIfStale(SESSION_TOKEN), UnauthorizedException);
      assert.deepEqual(deletedSessions, ['s1']);
    });

    it('rejects sessions that do not exist', async () => {
      await assert.rejects(service.refresh('unknown', { force: false }), UnauthorizedException);
    });
  });

  describe('waiting out a failure', () => {
    beforeEach(() => {
      failWith = new DiscordApiError(500, 'Discord request /users/@me/guilds failed (500)');
    });

    it('leaves Discord alone on the next requests instead of asking again a minute later', async () => {
      await service.refreshIfStale(SESSION_TOKEN);
      assert.equal(discordCalls, 1);

      await service.refreshIfStale(SESSION_TOKEN);
      await service.refreshIfStale(SESSION_TOKEN);
      assert.equal(discordCalls, 1);
    });

    it('still runs a refresh the user asked for themselves', async () => {
      await service.refreshIfStale(SESSION_TOKEN);
      await assert.rejects(service.refresh(SESSION_TOKEN, { force: true }), BadGatewayException);
      assert.equal(discordCalls, 2);
    });

    it('tries again once the wait is over, and waits twice as long when that fails too', async () => {
      mock.timers.enable({ apis: ['Date'], now: Date.now() });
      try {
        await service.refreshIfStale(SESSION_TOKEN);
        assert.equal(discordCalls, 1);

        mock.timers.tick(APP_CONFIG.discordSyncRetryBaseMs + 1);
        await service.refreshIfStale(SESSION_TOKEN);
        assert.equal(discordCalls, 2);

        mock.timers.tick(APP_CONFIG.discordSyncRetryBaseMs + 1);
        await service.refreshIfStale(SESSION_TOKEN);
        assert.equal(discordCalls, 2, 'the second failure doubled the wait');
      } finally {
        mock.timers.reset();
      }
    });

    it('forgets the wait as soon as a sync works again', async () => {
      mock.timers.enable({ apis: ['Date'], now: Date.now() });
      try {
        await service.refreshIfStale(SESSION_TOKEN);
        mock.timers.tick(APP_CONFIG.discordSyncRetryBaseMs + 1);

        failWith = null;
        await service.refreshIfStale(SESSION_TOKEN);
        await service.refreshIfStale(SESSION_TOKEN);
        assert.equal(discordCalls, 3);
      } finally {
        mock.timers.reset();
      }
    });
  });
});

describe('describeError', () => {
  it('names a Discord failure by the route and status in its message', () => {
    const error = new DiscordApiError(429, 'Discord request /users/@me/guilds failed (429)');
    assert.equal(
      describeError(error),
      'DiscordApiError: Discord request /users/@me/guilds failed (429)',
    );
  });

  it('unwraps the cause a network failure hides behind "fetch failed"', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('getaddrinfo EAI_AGAIN discord.com'),
    });
    assert.equal(
      describeError(error),
      'TypeError: fetch failed <- Error: getaddrinfo EAI_AGAIN discord.com',
    );
  });

  it('names a timed-out call', () => {
    const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    assert.equal(describeError(error), 'TimeoutError: The operation was aborted due to timeout');
  });

  it('survives anything that is not an error', () => {
    assert.equal(describeError('plain string'), 'plain string');
  });
});
