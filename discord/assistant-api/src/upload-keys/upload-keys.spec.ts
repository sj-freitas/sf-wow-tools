import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import { UploadKeyGuard } from './upload-key.guard';
import { MAX_KEYS, UploadKeysService } from './upload-keys.service';

interface Row {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const USER = { id: 'u1', discordId: '150', username: 'shivan', displayName: null, avatar: null };

/** The upload_keys table, in memory. */
function fakePrisma() {
  const rows: Row[] = [];
  const prisma = {
    uploadKey: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        rows.filter((row) => row.userId === where.userId),
      count: async ({ where }: { where: { userId: string } }) =>
        rows.filter((row) => row.userId === where.userId).length,
      create: async ({ data }: { data: Omit<Row, 'id' | 'createdAt' | 'lastUsedAt'> }) => {
        const row = { ...data, id: `k${rows.length + 1}`, createdAt: new Date(), lastUsedAt: null };
        rows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: string; userId: string } }) => {
        const index = rows.findIndex((row) => row.id === where.id && row.userId === where.userId);
        if (index >= 0) rows.splice(index, 1);
        return { count: index >= 0 ? 1 : 0 };
      },
      findUnique: async ({ where }: { where: { keyHash: string } }) => {
        const row = rows.find((candidate) => candidate.keyHash === where.keyHash);
        return row ? { ...row, user: USER } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        Object.assign(
          rows.find((row) => row.id === where.id)!,
          data,
        );
        return { id: where.id };
      },
    },
  } as unknown as PrismaService;
  return { prisma, rows };
}

describe('UploadKeysService', () => {
  let rows: Row[];
  let keys: UploadKeysService;

  beforeEach(() => {
    const fake = fakePrisma();
    rows = fake.rows;
    keys = new UploadKeysService(fake.prisma);
  });

  it('makes a key that is shown once and kept only as its hash', async () => {
    const created = await keys.create('u1', '  MacBook ');
    assert.match(created.key, /^gak_[A-Za-z0-9_-]{32}$/);
    assert.equal(created.name, 'MacBook');
    assert.equal(created.prefix, created.key.slice(0, 10));
    assert.equal(rows[0].keyHash, createHash('sha256').update(created.key).digest('hex'));
    assert.ok(!JSON.stringify(rows).includes(created.key));
    // The list never has the key.
    const listed = await keys.list('u1');
    assert.deepEqual(Object.keys(listed[0]).sort(), [
      'createdAt',
      'id',
      'lastUsedAt',
      'name',
      'prefix',
    ]);
    assert.deepEqual(await keys.list('u2'), []);
  });

  it('wants a name, short, and no more than ten keys', async () => {
    await assert.rejects(keys.create('u1', ' '), /name/);
    await assert.rejects(keys.create('u1', 'x'.repeat(41)), /40 characters/);
    for (let i = 0; i < MAX_KEYS; i++) await keys.create('u1', `Key ${i}`);
    await assert.rejects(keys.create('u1', 'One more'), /delete one/);
  });

  it('knows whose a key is, notes it was used, and forgets a deleted one', async () => {
    const { key, id } = await keys.create('u1', 'MacBook');
    assert.deepEqual(await keys.userOf(key), {
      id: 'u1',
      discordId: '150',
      username: 'shivan',
      displayName: 'shivan',
      avatar: null,
    });
    assert.ok(rows[0].lastUsedAt instanceof Date);
    assert.equal(await keys.userOf('gak_not-a-key'), null);
    assert.equal(await keys.userOf('session-token'), null);
    // Only its player deletes it.
    await assert.rejects(keys.delete('u2', id), /already gone/);
    await keys.delete('u1', id);
    assert.equal(await keys.userOf(key), null);
  });
});

describe('UploadKeyGuard', () => {
  const context = (authorization?: string) => {
    const req: { headers: { authorization?: string }; user?: unknown } = {
      headers: { authorization },
    };
    return {
      req,
      context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext,
    };
  };

  it('lets in a Bearer upload key as its player, and nothing else', async () => {
    const keys = new UploadKeysService(fakePrisma().prisma);
    const guard = new UploadKeyGuard(keys);
    const { key } = await keys.create('u1', 'MacBook');
    const ok = context(`Bearer ${key}`);
    assert.equal(await guard.canActivate(ok.context), true);
    assert.equal((ok.req.user as { id: string }).id, 'u1');
    for (const header of [undefined, key, `Basic ${key}`, 'Bearer gak_wrong']) {
      await assert.rejects(guard.canActivate(context(header).context), /upload key/);
    }
  });
});
