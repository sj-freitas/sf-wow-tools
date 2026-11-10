import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { CacheService } from '../cache/cache.service';
import type { CharactersService } from '../characters/characters.service';
import type { PrismaService } from '../database/prisma.service';
import { ArmoryError, type ArmoryQuery, type ArmoryService } from '../armory/armory.service';
import { BattleNetController } from './battlenet.controller';
import { accountLabel, BattleNetService, serverLabel } from './battlenet.service';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;
const CONFIGURED = {
  BLIZZARD_CLIENT_ID: 'client',
  BLIZZARD_CLIENT_SECRET: 'secret',
  SITE_URL: 'https://guild.test',
};

/** Forever's account list: last names, Blizzard's ids, and no server for any character. */
const FOREVER_ACCOUNT = {
  wow_accounts: [
    {
      characters: [
        {
          id: 101,
          name: 'Aqua',
          surname: 'Aquantos',
          level: 60,
          playable_class: { name: 'Warrior' },
          playable_race: { name: 'Human' },
          faction: { name: 'Alliance' },
        },
        { id: 102, name: 'Elsewhere', surname: 'Pvper', level: 10 },
      ],
    },
    { characters: [{ id: 103, name: 'Altie', surname: 'Twink', level: 25 }] },
  ],
};

/** Battle.net answering the token, the account's characters and its BattleTag. */
function fakeBattleNet(service: BattleNetService, account: unknown = FOREVER_ACCOUNT) {
  const asked: { url: string; init?: RequestInit }[] = [];
  service.fetcher = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    if (url.endsWith('/token')) return Response.json({ access_token: 'player-token' });
    if (url.endsWith('/userinfo')) return Response.json({ battletag: 'Shivan#1234' });
    return Response.json(account);
  }) as typeof fetch;
  return asked;
}

/** The armory: characters by full name ("aqua aquantos"), with their id and rule set. */
function fakeArmory(
  characters: Record<string, { id?: number; realm: string } | 'down'> = {
    'aqua aquantos': { id: 101, realm: 'Roleplay' },
  },
) {
  const asked: { query: ArmoryQuery; talents?: boolean }[] = [];
  const armory = {
    lookup: async (query: ArmoryQuery, options: { talents?: boolean } = {}) => {
      asked.push({ query, talents: options.talents });
      const found = characters[`${query.name} ${query.lastName}`.toLowerCase()];
      if (found === 'down') throw new ArmoryError('unavailable', 'The armory answered 503.');
      if (!found) throw new ArmoryError('not-found', 'No character called that.');
      return { ...found, name: query.name, class: 'Warrior', race: 'Human', level: 60 };
    },
  } as unknown as ArmoryService;
  return { armory, asked };
}

const rp = { gameVersion: 'Forever', region: 'EU', server: 'RP' };

describe('BattleNetService', () => {
  it('sends the player to Battle.net for wow.profile, back to the site', () => {
    const url = new URL(
      new BattleNetService(config(CONFIGURED), fakeArmory().armory).authorizeUrl('s1'),
    );
    assert.equal(url.origin + url.pathname, 'https://oauth.battle.net/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client');
    assert.equal(url.searchParams.get('scope'), 'openid wow.profile');
    assert.equal(url.searchParams.get('state'), 's1');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://guild.test/api/battlenet/callback');
  });

  it('reads the account’s characters in the version and region, every server, by name', async () => {
    const service = new BattleNetService(config(CONFIGURED), fakeArmory().armory);
    const asked = fakeBattleNet(service);
    const token = await service.exchange('code-1');
    assert.equal(token, 'player-token');
    assert.match(asked[0].init?.body as string, /grant_type=authorization_code&code=code-1/);
    assert.deepEqual(
      (await service.characters(token, rp)).map((c) => [c.id, c.name, c.level, c.server]),
      [
        [103, 'Altie Twink', 25, null],
        [101, 'Aqua Aquantos', 60, null],
        [102, 'Elsewhere Pvper', 10, null],
      ],
    );
    // Forever's armory in the character's region.
    assert.equal(
      asked.at(-1)?.url,
      'https://eu.api.blizzard.com/profile/user/wow?namespace=profile-forever-eu&locale=en_GB',
    );
    assert.equal(serverLabel(rp), 'EU · Forever · RP');
    assert.equal(accountLabel(rp), 'EU · Forever');
  });

  it('reads the character in the armory: its id and its server’s rule set', async () => {
    const { armory, asked } = fakeArmory({
      'aqua aquantos': { id: 101, realm: 'Roleplay' },
      'busy body': 'down',
    });
    const service = new BattleNetService(config(CONFIGURED), armory);
    assert.deepEqual(await service.armoryEntry(rp, 'Aqua', 'Aquantos'), {
      id: 101,
      ruleset: 'Roleplay',
    });
    assert.deepEqual(asked[0], {
      query: { namespace: 'profile-forever-eu', region: 'EU', name: 'Aqua', lastName: 'Aquantos' },
      talents: false,
    });
    assert.equal(await service.armoryEntry(rp, 'Nobody', 'Here'), null);
    await assert.rejects(service.armoryEntry(rp, 'Busy', 'Body'), /armory couldn’t be read/);
  });

  it('knows each server’s rule set, and refuses a server or version it doesn’t know', async () => {
    const service = new BattleNetService(config(CONFIGURED), fakeArmory().armory);
    assert.equal(service.ruleset(rp), 'Roleplay');
    assert.equal(service.ruleset({ ...rp, server: 'PVP' }), 'PvP');
    assert.throws(() => service.ruleset({ ...rp, server: 'Wild' }), /isn’t a server/);
    await assert.rejects(service.characters('t', { ...rp, gameVersion: 'Retail' }), /no armory/);
  });
});

describe('BattleNetController', () => {
  function setup(values = CONFIGURED, armory = fakeArmory().armory) {
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
                firstName: 'Aqua',
                lastName: 'Aquantos',
                gameVersion: 'Forever',
                region: 'EU',
                realm: 'RP',
              }
            : null,
      },
    } as unknown as PrismaService;
    const service = new BattleNetService(config(values), armory);
    fakeBattleNet(service);
    // Who verified which character (c1 is someone else's until u1 verifies it).
    const verified: { characterId: string; owner: unknown }[] = [];
    const characters = {
      verify: async (characterId: string, owner: unknown) => {
        verified.push({ characterId, owner });
        return { moved: true };
      },
    } as unknown as CharactersService;
    const controller = new BattleNetController(service, cache, prisma, characters);
    const req = (userId: string) =>
      ({
        user: { id: userId, discordId: `d-${userId}`, username: userId, displayName: 'Shivan' },
      }) as unknown as AuthenticatedRequest;
    let redirected = '';
    const res = { redirect: (to: string) => void (redirected = to) } as unknown as Response;
    return { controller, req, res, store, verified, redirectedTo: () => redirected };
  }

  /** Logs in for c1 (Aqua Aquantos on EU RP) and returns what the check found. */
  async function check(armory = fakeArmory().armory) {
    const { controller, req, res, redirectedTo, verified } = setup(CONFIGURED, armory);
    await controller.login(req('u1'), res, 'c1');
    const state = new URL(redirectedTo()).searchParams.get('state')!;
    await controller.callback(req('u1'), res, 'code-1', state);
    const id = redirectedTo().replace('/battlenet/', '');
    return { result: await controller.result(req('u1'), id), controller, req, id, verified };
  }

  it('finds the character on the account and on its server, and verifies it for them', async () => {
    const { result, controller, req, id, verified } = await check();
    assert.deepEqual(result.character, {
      name: 'Aqua Aquantos',
      pagePath: '/forever/eu/rp/characters/Aqua-Aquantos',
    });
    assert.equal(result.server, 'EU · Forever · RP');
    assert.equal(result.account, 'EU · Forever');
    assert.equal(result.battleTag, 'Shivan#1234');
    assert.equal(result.found, true);
    assert.equal(result.armoryServer, 'Roleplay');
    assert.equal(result.sameServer, true);
    assert.deepEqual(
      result.characters.map((c) => c.name),
      ['Altie Twink', 'Aqua Aquantos', 'Elsewhere Pvper'],
    );
    assert.equal(result.error, null);
    // Verified, for the player who logged in (and moved to them).
    assert.deepEqual(verified, [
      {
        characterId: 'c1',
        owner: { discordUserId: 'd-u1', names: { username: 'u1', displayName: 'Shivan' } },
      },
    ]);
    assert.equal(result.verified, true);
    assert.equal(result.moved, true);
    // Someone else can't see it.
    await assert.rejects(controller.result(req('u2'), id), /expired/);
  });

  it('tells apart a character on another server, or someone else’s with the same name', async () => {
    let { result, verified } = await check(
      fakeArmory({ 'aqua aquantos': { id: 101, realm: 'PvP' } }).armory,
    );
    assert.equal(result.found, true);
    assert.equal(result.armoryServer, 'PvP');
    assert.equal(result.sameServer, false);
    // Neither is verified.
    assert.deepEqual([verified, result.verified, result.moved], [[], false, false]);
    // The armory's Aqua Aquantos isn't the account's (another id): not theirs.
    ({ result, verified } = await check(
      fakeArmory({ 'aqua aquantos': { id: 999, realm: 'Roleplay' } }).armory,
    ));
    assert.equal(result.found, false);
    assert.equal(result.sameServer, true);
    assert.deepEqual([verified, result.verified], [[], false]);
  });

  it('goes by name when the armory doesn’t have the character yet, but doesn’t verify it', async () => {
    const { result, verified } = await check(fakeArmory({}).armory);
    assert.equal(result.found, true);
    assert.equal(result.armoryServer, null);
    assert.equal(result.sameServer, false);
    assert.equal(result.error, null);
    // Its server isn't confirmed.
    assert.deepEqual([verified, result.verified], [[], false]);
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
