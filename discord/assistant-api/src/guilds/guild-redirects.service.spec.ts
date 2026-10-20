import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import type { PrismaService } from '../database/prisma.service';
import { GuildRedirectsService } from './guild-redirects.service';

const RENAMED = { gameVersion: 'Forever', region: 'EU', realm: 'PvP', name: 'New Name' };

describe('GuildRedirectsService', () => {
  const service = () => {
    const prisma = {
      guildPathAlias: {
        findUnique: async ({ where }: { where: { path: string } }) =>
          where.path === 'forever/eu/pvp/guilds/old-name' ? { guild: RENAMED } : null,
      },
    } as unknown as PrismaService;
    return new GuildRedirectsService(prisma);
  };

  const load = (url: string) =>
    new Promise<{ redirect?: string; status?: number; next: boolean }>((resolve) => {
      const req = { method: 'GET', path: url.split('?')[0], originalUrl: url } as Request;
      const res = {
        redirect: (status: number, to: string) => resolve({ status, redirect: to, next: false }),
      } as unknown as Response;
      service().middleware(req, res, () => resolve({ next: true }));
    });

  it('resolves an old address to the guild’s address now', async () => {
    assert.equal(
      await service().resolve('forever/eu/pvp/guilds/old-name'),
      'forever/eu/pvp/guilds/new-name',
    );
    assert.equal(
      await service().resolve('Forever/EU/PvP/guilds/Old-Name'),
      'forever/eu/pvp/guilds/new-name',
    );
    assert.equal(await service().resolve('forever/eu/pvp/guilds/unknown'), null);
  });

  it('redirects a page load of an old address, keeping the page and query', async () => {
    assert.deepEqual(await load('/forever/eu/pvp/guilds/old-name/signup/abc?tab=setup'), {
      status: 302,
      redirect: '/forever/eu/pvp/guilds/new-name/signup/abc?tab=setup',
      next: false,
    });
    assert.deepEqual(await load('/forever/eu/pvp/guilds/old-name'), {
      status: 302,
      redirect: '/forever/eu/pvp/guilds/new-name',
      next: false,
    });
  });

  it('lets anything else through', async () => {
    assert.deepEqual(await load('/forever/eu/pvp/guilds/new-name/roster'), { next: true });
    assert.deepEqual(await load('/forever/eu/pvp/characters/someone'), { next: true });
    assert.deepEqual(await load('/overview'), { next: true });
  });
});
