import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { CacheService } from '../cache/cache.service';
import type { PrismaService } from '../database/prisma.service';
import { BattleNetController } from './battlenet.controller';
import { BattleNetService } from './battlenet.service';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;
const CONFIGURED = {
  BLIZZARD_CLIENT_ID: 'client',
  BLIZZARD_CLIENT_SECRET: 'secret',
  SITE_URL: 'https://guild.test',
};

/** Battle.net answering the token, the account's characters and its BattleTag. */
function fakeBattleNet(service: BattleNetService) {
  const asked: { url: string; init?: RequestInit }[] = [];
  service.fetcher = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    if (url.endsWith('/token')) return Response.json({ access_token: 'player-token' });
    if (url.endsWith('/userinfo')) return Response.json({ battletag: 'Shivan#1234' });
    return Response.json({
      wow_accounts: [
        {
          characters: [
            {
              name: 'Darkshivan',
              level: 60,
              realm: { name: 'Wild Growth', slug: 'wild-growth' },
              playable_class: { name: 'Warrior' },
              playable_race: { name: 'Human' },
              faction: { name: 'Alliance' },
            },
            { name: 'Elsewhere', level: 10, realm: { name: 'Lone Wolf', slug: 'lone-wolf' } },
          ],
        },
        { characters: [{ name: 'Altie', level: 25, realm: { slug: 'wild-growth' } }] },
      ],
    });
  }) as typeof fetch;
  return asked;
}

describe('BattleNetService', () => {
  it('sends the player to Battle.net for wow.profile, back to the site', () => {
    const url = new URL(new BattleNetService(config(CONFIGURED)).authorizeUrl('s1'));
    assert.equal(url.origin + url.pathname, 'https://oauth.battle.net/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client');
    assert.equal(url.searchParams.get('scope'), 'openid wow.profile');
    assert.equal(url.searchParams.get('state'), 's1');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://guild.test/api/battlenet/callback');
  });

  it('reads the account’s characters on the checked server only, by name', async () => {
    const service = new BattleNetService(config(CONFIGURED));
    const asked = fakeBattleNet(service);
    const token = await service.exchange('code-1');
    assert.equal(token, 'player-token');
    assert.match(asked[0].init?.body as string, /grant_type=authorization_code&code=code-1/);
    assert.deepEqual(
      (await service.characters(token)).map((c) => [c.name, c.level, c.class]),
      [
        ['Altie', 25, null],
        ['Darkshivan', 60, 'Warrior'],
      ],
    );
  });
});

describe('BattleNetController', () => {
  function setup(values = CONFIGURED) {
    const store = new Map<string, unknown>();
    const cache = {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
    } as unknown as CacheService;
    const prisma = {
      character: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === 'c1'
            ? {
                id: 'c1',
                firstName: 'Darkshivan',
                lastName: '',
                gameVersion: 'Forever',
                region: 'EU',
                realm: 'RP',
              }
            : null,
      },
    } as unknown as PrismaService;
    const service = new BattleNetService(config(values));
    fakeBattleNet(service);
    const controller = new BattleNetController(service, cache, prisma);
    const req = (userId: string) => ({ user: { id: userId } }) as unknown as AuthenticatedRequest;
    let redirected = '';
    const res = { redirect: (to: string) => void (redirected = to) } as unknown as Response;
    return { controller, req, res, store, redirectedTo: () => redirected };
  }

  it('shows the player their characters on the server, and whether this one is there', async () => {
    const { controller, req, res, redirectedTo } = setup();
    await controller.login(req('u1'), res, 'c1');
    const state = new URL(redirectedTo()).searchParams.get('state')!;
    await controller.callback(req('u1'), res, 'code-1', state);
    const id = redirectedTo().replace('/battlenet/', '');
    const result = await controller.result(req('u1'), id);
    assert.deepEqual(result.character, {
      name: 'Darkshivan',
      pagePath: '/forever/eu/rp/characters/Darkshivan',
    });
    assert.equal(result.battleTag, 'Shivan#1234');
    assert.equal(result.found, true);
    assert.deepEqual(
      result.characters.map((c) => c.name),
      ['Altie', 'Darkshivan'],
    );
    assert.equal(result.error, null);
    // Someone else can't see it.
    await assert.rejects(controller.result(req('u2'), id), /expired/);
  });

  it('ignores a callback that isn’t the player’s own login', async () => {
    const { controller, req, res, redirectedTo } = setup();
    await controller.login(req('u1'), res, 'c1');
    const state = new URL(redirectedTo()).searchParams.get('state')!;
    await controller.callback(req('u2'), res, 'code-1', state);
    assert.equal(redirectedTo(), '/');
  });

  it('says so when the login was cancelled, or Battle.net isn’t set up', async () => {
    const { controller, req, res, redirectedTo } = setup();
    await controller.login(req('u1'), res, 'c1');
    const state = new URL(redirectedTo()).searchParams.get('state')!;
    await controller.callback(req('u1'), res, undefined, state, 'access_denied');
    let result = await controller.result(req('u1'), redirectedTo().replace('/battlenet/', ''));
    assert.match(result.error ?? '', /cancelled/);

    const bare = setup({ SITE_URL: 'https://guild.test' } as typeof CONFIGURED);
    await bare.controller.login(bare.req('u1'), bare.res, 'c1');
    result = await bare.controller.result(
      bare.req('u1'),
      bare.redirectedTo().replace('/battlenet/', ''),
    );
    assert.match(result.error ?? '', /not set up/);
  });
});
