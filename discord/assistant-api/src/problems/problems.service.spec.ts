import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DiscordAPIError } from '@discordjs/rest';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { PERMISSIONS as P } from './channel-permissions';
import { ProblemsService, type ProblemTask } from './problems.service';

/** A Discord error with that code (50013: missing permissions, 10003: unknown channel, …). */
const discordError = (code: number) =>
  new DiscordAPIError({ code, message: 'x' }, code, 403, 'POST', '/x', { body: {}, files: [] });

describe('ProblemsService', () => {
  let rows: Record<string, unknown>[];
  let posted: string[];
  let dms: string[];
  let officerChannel: string | null;
  let service: ProblemsService;

  const task: ProblemTask = {
    guildId: 'g1',
    source: 'POST',
    id: 't1',
    label: 'Molten Core sign-ups',
    channelId: '123456',
    use: 'post',
  };

  beforeEach(() => {
    rows = [];
    posted = [];
    dms = [];
    officerChannel = 'officers';
    const key = (w: { guildId: string; source: string; sourceId: string }) =>
      rows.find(
        (r) => r.guildId === w.guildId && r.source === w.source && r.sourceId === w.sourceId,
      );
    const prisma = {
      guildProblem: {
        findUnique: async ({ where }: { where: { guildId_source_sourceId: never } }) =>
          key(where.guildId_source_sourceId) ?? null,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { guildId_source_sourceId: { guildId: string; source: string; sourceId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const row = key(where.guildId_source_sourceId);
          if (row) Object.assign(row, update);
          else rows.push({ ...create, id: `p${rows.length}`, since: new Date() });
        },
        deleteMany: async ({
          where,
        }: {
          where: { guildId: string; id?: string; source?: string; sourceId?: string };
        }) => {
          const before = rows.length;
          rows = rows.filter(
            (r) =>
              !(
                r.guildId === where.guildId &&
                (where.id === undefined || r.id === where.id) &&
                (where.sourceId === undefined || r.sourceId === where.sourceId)
              ),
          );
          return { count: before - rows.length };
        },
        findMany: async () => rows,
      },
      guild: { findUnique: async () => ({ officerRequestChannelId: officerChannel }) },
      guildAccess: {
        findMany: async () => [
          { user: { discordId: 'admin-1' } },
          { user: { discordId: 'admin-2' } },
        ],
      },
    } as unknown as PrismaService;
    const bot = {
      // The bot's role can view and send, but not embed or react, in the channel.
      channelPermissionInputs: async () => ({
        serverId: 's1',
        memberId: 'bot',
        memberRoleIds: ['r'],
        roles: [
          { id: 's1', permissions: P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY },
          { id: 'r', permissions: P.SEND_MESSAGES },
        ],
        overwrites: [],
      }),
      postMessage: async (channelId: string, text: string) => {
        if (channelId === 'broken') throw discordError(50013);
        posted.push(text);
        return 'm1';
      },
      sendDirectMessage: async (userId: string) => {
        if (userId === 'admin-2') throw discordError(50007); // DMs closed
        dms.push(userId);
      },
    } as unknown as DiscordBotService;
    service = new ProblemsService(prisma, bot);
  });

  it('records a failure an officer can fix, with what is missing, and says so once', async () => {
    await service.report(task, discordError(50013));
    await service.report(task, discordError(50013)); // the retry
    await service.report(task, discordError(50013));
    const [problem] = await service.list('g1');
    assert.equal(problem.label, 'Molten Core sign-ups');
    assert.match(problem.detail, /missing Embed Links and Add Reactions/);
    assert.match(problem.detail, /in the settings of <#123456>/);
    assert.equal(posted.length, 1, 'one notice, not one per retry');
    assert.match(posted[0], /^⚠️ \*\*Molten Core sign-ups\*\*: the bot is missing/);
  });

  it('clears it when the task next succeeds, with one "Fixed" notice', async () => {
    await service.report(task, discordError(50013));
    await service.clear(task);
    await service.clear(task); // the next success: nothing more
    assert.deepEqual(await service.list('g1'), []);
    assert.deepEqual(posted.slice(1), ['✅ Fixed: **Molten Core sign-ups**.']);
  });

  it('lets an officer mark it solved; failing again brings it back, with a new notice', async () => {
    await service.report(task, discordError(50013));
    const [problem] = await service.list('g1');
    assert.equal(await service.resolve('other-guild', problem.id), false, 'only its own guild');
    assert.equal(await service.resolve('g1', problem.id), true);
    assert.deepEqual(await service.list('g1'), []);
    assert.equal(posted.length, 1, 'solving says nothing');
    // It wasn't really fixed: the next failure records and announces it again.
    await service.report(task, discordError(50013));
    assert.equal((await service.list('g1')).length, 1);
    assert.equal(posted.length, 2);
  });

  it('says a deleted channel is gone', async () => {
    await service.report(task, discordError(10003));
    assert.match((await service.list('g1'))[0].detail, /no longer exists. Choose another channel/);
  });

  it("leaves other failures to the task's own error (Discord down, not a Discord error)", async () => {
    await service.report(task, new Error('ECONNRESET'));
    await service.report(task, discordError(50035)); // invalid form body: not the officers' to fix
    assert.deepEqual(await service.list('g1'), []);
    assert.deepEqual(posted, []);
  });

  it('DMs the Guild-Assistants (once each) without an officer channel, or when it fails', async () => {
    officerChannel = null;
    await service.report(task, discordError(50013));
    assert.deepEqual(dms, ['admin-1'], 'closed DMs are left at that');
    dms = [];
    officerChannel = 'broken';
    await service.report({ ...task, id: 't2' }, discordError(50013));
    assert.deepEqual(dms, ['admin-1']);
  });

  it('never throws, even when the database does', async () => {
    const broken = new ProblemsService(
      {
        guildProblem: { findUnique: () => Promise.reject(new Error('db')) },
      } as unknown as PrismaService,
      {} as DiscordBotService,
    );
    await broken.report(task, discordError(50013));
    await broken.clear(task);
  });
});
