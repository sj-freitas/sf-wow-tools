import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import { MAX_IMAGE_BYTES } from '../officer-requests/attachments';
import { ORPHAN_IMAGE_MAX_AGE_MS, PostImagesService } from './post-images.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]);
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('PostImagesService', () => {
  let rows: any[];
  let updates: any[];
  let deletes: any[];
  let service: PostImagesService;

  beforeEach(() => {
    rows = [];
    updates = [];
    deletes = [];
    const prisma = {
      postImage: {
        create: async (args: any) => {
          const row = { id: A, ...args.data };
          rows.push(row);
          return { id: row.id, contentType: row.contentType, size: row.size };
        },
        findFirst: async (args: any) =>
          rows.find((r) => r.id === args.where.id && r.guildId === args.where.guildId) ?? null,
        findMany: async (args: any) =>
          rows.filter(
            (r) =>
              (!args.where.id || args.where.id.in.includes(r.id)) &&
              (!args.where.guildId || r.guildId === args.where.guildId),
          ),
        updateMany: async (args: any) => void updates.push(args),
        deleteMany: async (args: any) => {
          deletes.push(args);
          return { count: 2 };
        },
      },
    } as unknown as PrismaService;
    service = new PostImagesService(prisma);
  });

  describe('uploading', () => {
    it('stores the image with the type found in its bytes', async () => {
      assert.deepEqual(await service.upload('g', JPEG), {
        id: A,
        contentType: 'image/jpeg',
        size: JPEG.length,
      });
      assert.equal(rows[0].guildId, 'g');
    });

    it('refuses empty files, files that are not images, and files that are too big', async () => {
      await assert.rejects(service.upload('g', Buffer.alloc(0)), BadRequestException);
      await assert.rejects(
        service.upload('g', Buffer.from('<svg></svg>')),
        /PNG, JPEG, GIF or WebP/,
      );
      await assert.rejects(service.upload('g', Buffer.alloc(MAX_IMAGE_BYTES + 1)), /at most 5 MB/);
      assert.deepEqual(rows, []);
    });
  });

  describe('serving', () => {
    it('gives an image of the guild, and nothing for another guild or a bad id', async () => {
      await service.upload('g', PNG);
      assert.equal((await service.get('g', A))?.contentType, 'image/png');
      assert.equal(await service.get('other', A), null);
      assert.equal(await service.get('g', 'not-a-uuid'), null);
    });
  });

  describe('using images in a post', () => {
    beforeEach(() => {
      rows = [
        { id: A, guildId: 'g', taskId: null, contentType: 'image/png', data: PNG },
        { id: B, guildId: 'g', taskId: 't1', contentType: 'image/jpeg', data: JPEG },
        { id: C, guildId: 'g', taskId: 't2', contentType: 'image/png', data: PNG },
      ];
    });

    it('accepts new uploads and the post’s own images, but not another post’s', async () => {
      await service.assertUsable('g', 't1', [A, B]);
      await assert.rejects(service.assertUsable('g', 't1', [C]), /not available any more/);
      await assert.rejects(service.assertUsable('g', undefined, [B]), /not available any more/);
      await assert.rejects(service.assertUsable('other', 't1', [A]), /not available any more/);
    });

    it('makes the listed images the post’s and removes the ones it stopped using', async () => {
      await service.attach('t1', {
        serverId: 's',
        channelId: 'c',
        parts: [
          {
            id: 'p1',
            content: 'x',
            seedReactions: [],
            embedLinks: true,
            delaySeconds: 0,
            imageIds: [A],
          },
          {
            id: 'p2',
            content: 'y',
            seedReactions: [],
            embedLinks: true,
            delaySeconds: 0,
            imageIds: [B],
          },
        ],
      });
      assert.deepEqual(updates[0].where, { id: { in: [A, B] } });
      assert.deepEqual(updates[0].data, { taskId: 't1' });
      assert.deepEqual(deletes[0].where, { taskId: 't1', id: { notIn: [A, B] } });
    });

    it('gives the files of a message in order, with plain names', async () => {
      const files = await service.files([B, A]);
      assert.deepEqual(
        files.map((f) => [f.name, f.contentType]),
        [
          ['image-1.jpg', 'image/jpeg'],
          ['image-2.png', 'image/png'],
        ],
      );
      assert.deepEqual(await service.files([]), []);
    });
  });

  it('removes uploads nobody saved into a post after a day', async () => {
    const now = new Date('2026-10-05T12:00:00Z');
    assert.equal(await service.deleteOrphans(now), 2);
    assert.equal(deletes[0].where.taskId, null);
    assert.equal(deletes[0].where.createdAt.lt.getTime(), now.getTime() - ORPHAN_IMAGE_MAX_AGE_MS);
  });
});
