import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import { RetentionService } from './retention.service';

describe('RetentionService', () => {
  it('deletes post runs, plugin runs and honeypot events older than 6 months', async () => {
    const wheres: Record<string, unknown> = {};
    const table = (name: string, count: number) => ({
      deleteMany: (args: { where: unknown }) => {
        wheres[name] = args.where;
        return { count };
      },
    });
    const prisma = {
      taskRun: table('taskRun', 3),
      pluginRun: table('pluginRun', 2),
      honeypotEvent: table('honeypotEvent', 1),
      $transaction: async (calls: { count: number }[]) => calls,
    } as unknown as PrismaService;

    const deleted = await new RetentionService(prisma).run(new Date('2026-10-20T12:00:00Z'));
    assert.equal(deleted, 6);
    const cutoff = new Date('2026-04-20T12:00:00Z');
    assert.deepEqual(wheres.taskRun, { scheduledFor: { lt: cutoff } });
    assert.deepEqual(wheres.pluginRun, { startedAt: { lt: cutoff } });
    assert.deepEqual(wheres.honeypotEvent, { createdAt: { lt: cutoff } });
  });

  it('never throws', async () => {
    const prisma = {
      taskRun: { deleteMany: () => ({}) },
      pluginRun: { deleteMany: () => ({}) },
      honeypotEvent: { deleteMany: () => ({}) },
      $transaction: async () => {
        throw new Error('database down');
      },
    } as unknown as PrismaService;
    assert.equal(await new RetentionService(prisma).run(), 0);
  });
});
