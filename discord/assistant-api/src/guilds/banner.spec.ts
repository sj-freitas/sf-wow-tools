import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { BadRequestException, ForbiddenException, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordOAuthService } from '../auth/discord-oauth.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { readBody, sniffImageType } from './banner';
import { GuildsController } from './guilds.controller';
import { GuildsService } from './guilds.service';
import type { RanksService } from './ranks.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]);
const GIF = Buffer.from('GIF89a....');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 2, 3, 4]),
  Buffer.from('WEBPVP8 '),
]);

describe('sniffImageType', () => {
  it('recognises PNG, JPEG, GIF and WebP by their first bytes', () => {
    assert.equal(sniffImageType(PNG), 'image/png');
    assert.equal(sniffImageType(JPEG), 'image/jpeg');
    assert.equal(sniffImageType(GIF), 'image/gif');
    assert.equal(sniffImageType(WEBP), 'image/webp');
  });

  it('refuses everything else, including SVG, HTML and empty files', () => {
    assert.equal(
      sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
      null,
    );
    assert.equal(sniffImageType(Buffer.from('<html><script>alert(1)</script>')), null);
    assert.equal(sniffImageType(Buffer.from('RIFF....WAVEfmt ')), null);
    assert.equal(sniffImageType(Buffer.alloc(0)), null);
  });
});

describe('readBody', () => {
  const stream = (...chunks: Buffer[]) => Readable.from(chunks) as unknown as IncomingMessage;

  it('joins the chunks', async () => {
    assert.deepEqual(await readBody(stream(PNG.subarray(0, 4), PNG.subarray(4)), 100), PNG);
  });

  it('gives up once the body is bigger than the limit', async () => {
    await assert.rejects(
      readBody(stream(Buffer.alloc(60), Buffer.alloc(60)), 100),
      PayloadTooLargeException,
    );
  });
});

describe('guild banner', () => {
  let stored: { guildId: string; contentType: string; data: Uint8Array } | null;
  let events: string[];
  let service: GuildsService;

  const setup = () => {
    stored = null;
    events = [];
    const prisma = {
      guildBanner: {
        upsert: async (args: any) =>
          void (stored = { guildId: args.where.guildId, ...args.create }),
        findUnique: async () => stored,
        deleteMany: async () => void (stored = null),
      },
    } as unknown as PrismaService;
    const realtime = {
      publish: (_guild: string, type: string) => void events.push(type),
    } as unknown as RealtimeService;
    service = new GuildsService(prisma, realtime, {} as DiscordOAuthService);
  };

  it('stores an image with the type found in its bytes, and tells the backoffice', async () => {
    setup();
    await service.setBanner('g', PNG);
    assert.equal(stored?.contentType, 'image/png');
    assert.deepEqual(await service.getBanner('g'), { contentType: 'image/png', data: PNG });
    assert.deepEqual(events, ['guild']);
  });

  it('rejects empty uploads and anything that is not an image', async () => {
    setup();
    await assert.rejects(service.setBanner('g', Buffer.alloc(0)), BadRequestException);
    await assert.rejects(service.setBanner('g', Buffer.from('<svg></svg>')), BadRequestException);
    assert.equal(stored, null);
  });

  it('removes the banner', async () => {
    setup();
    await service.setBanner('g', PNG);
    await service.removeBanner('g');
    assert.equal(await service.getBanner('g'), null);
  });
});

describe('GuildsController banner routes', () => {
  let member: boolean;
  let configurer: boolean;
  let calls: string[];
  let controller: GuildsController;
  const req = Object.assign(Readable.from([PNG]), {
    user: { id: 'u1' },
  }) as unknown as AuthenticatedRequest;
  const res = () => {
    const sent: { status?: number; headers?: Record<string, string>; body?: unknown } = {};
    const response: any = {
      status: (code: number) => ((sent.status = code), response),
      json: (body: unknown) => ((sent.body = body), response),
      set: (headers: Record<string, string>) => ((sent.headers = headers), response),
      send: (body: unknown) => ((sent.body = body), response),
    };
    return { response, sent };
  };

  const build = () => {
    member = true;
    configurer = true;
    calls = [];
    const guildAccess = {
      find: async () => (member ? { isAdmin: false, isOfficer: false } : null),
      assertCanConfigure: async () => {
        if (!configurer) throw new ForbiddenException();
      },
    } as unknown as GuildAccessService;
    const guilds = {
      getBanner: async () => ({ contentType: 'image/png', data: PNG }),
      setBanner: async (...args: unknown[]) => void calls.push(`set:${String(args[0])}`),
      removeBanner: async () => void calls.push('remove'),
    } as unknown as GuildsService;
    controller = new GuildsController(
      guilds,
      guildAccess,
      {} as AuthService,
      {} as RanksService,
      { getOrThrow: () => 'app-id', get: () => undefined } as unknown as ConfigService,
    );
  };

  it('serves the banner to members of the guild, with its own content type', async () => {
    build();
    const { response, sent } = res();
    await controller.banner(req, 'g', response);
    assert.equal(sent.headers?.['Content-Type'], 'image/png');
    assert.deepEqual(sent.body, PNG);
  });

  it('does not serve it to people outside the guild', async () => {
    build();
    member = false;
    await assert.rejects(controller.banner(req, 'g', res().response), ForbiddenException);
  });

  it('lets only those who can configure the guild upload or remove it', async () => {
    build();
    await controller.setBanner(req, 'g');
    await controller.removeBanner(req, 'g');
    assert.deepEqual(calls, ['set:g', 'remove']);
    configurer = false;
    await assert.rejects(controller.setBanner(req, 'g'), ForbiddenException);
    await assert.rejects(controller.removeBanner(req, 'g'), ForbiddenException);
    assert.equal(calls.length, 2);
  });
});
