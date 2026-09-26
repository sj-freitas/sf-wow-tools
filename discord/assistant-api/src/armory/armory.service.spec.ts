import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { GuildAccessService } from '../auth/guild-access.service';
import { ArmoryController } from './armory.controller';
import { ArmoryError, ArmoryService } from './armory.service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const PROFILE = {
  name: 'Susaru',
  faction: { name: 'Alliance' },
  race: { name: 'Night Elf' },
  character_class: { name: 'Druid' },
  realm: { name: 'Wild Growth' },
  level: 60,
};

describe('ArmoryService', () => {
  let env: Record<string, string | undefined>;
  let calls: { url: string; init?: RequestInit }[];
  let profile: () => Response;
  let token: () => Response;
  let service: ArmoryService;

  beforeEach(() => {
    env = { BLIZZARD_CLIENT_ID: 'id', BLIZZARD_CLIENT_SECRET: 'secret' };
    calls = [];
    profile = () => json(PROFILE);
    token = () => json({ access_token: 'tok', expires_in: 86399 });
    service = new ArmoryService({ get: (key: string) => env[key] } as unknown as ConfigService);
    service.fetcher = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return url.includes('oauth.battle.net') ? token() : profile();
    };
  });

  it('logs in with the client (no player) and asks for the character on Wild Growth, EU', async () => {
    assert.deepEqual(await service.lookup('Susaru'), {
      name: 'Susaru',
      class: 'Druid',
      race: 'Night Elf',
      level: 60,
      faction: 'Alliance',
      realm: 'Wild Growth',
    });
    const [login, lookup] = calls;
    assert.equal(login.url, 'https://oauth.battle.net/token');
    assert.equal(login.init?.body, 'grant_type=client_credentials');
    assert.equal(
      (login.init?.headers as Record<string, string>).Authorization,
      `Basic ${Buffer.from('id:secret').toString('base64')}`,
    );
    assert.equal(
      lookup.url,
      'https://eu.api.blizzard.com/profile/wow/character/wild-growth/susaru?namespace=profile-classic1x-eu&locale=en_GB',
    );
    assert.equal((lookup.init?.headers as Record<string, string>).Authorization, 'Bearer tok');
  });

  it('keeps the token, so a second lookup does not log in again', async () => {
    await service.lookup('Susaru');
    await service.lookup('Blomio');
    assert.equal(calls.filter((c) => c.url.includes('oauth')).length, 1);
  });

  it('gets a new token once when the armory refuses the old one', async () => {
    await service.lookup('Susaru');
    let refused = true;
    profile = () => {
      const answer = refused ? json({}, 401) : json(PROFILE);
      refused = false;
      return answer;
    };
    assert.equal((await service.lookup('Susaru')).name, 'Susaru');
    assert.equal(calls.filter((c) => c.url.includes('oauth')).length, 2);
  });

  it('writes a name with accents into the address safely, lower case', async () => {
    await service.lookup('Jürgën');
    assert.match(calls[1].url, /wild-growth\/j%C3%BCrg%C3%ABn\?/);
  });

  it('refuses names that are not a name, without asking anyone', async () => {
    for (const bad of ['', 'a', '../../x', 'name/ok', 'a b', 'x'.repeat(25), '1234']) {
      await assert.rejects(service.lookup(bad), (e: ArmoryError) => e.failure === 'not-found', bad);
    }
    assert.deepEqual(calls, []);
  });

  it('says when the armory is not set up, without asking anyone', async () => {
    env = {};
    await assert.rejects(
      service.lookup('Susaru'),
      (e: ArmoryError) => e.failure === 'not-configured',
    );
    assert.deepEqual(calls, []);
    assert.equal(service.configured, false);
  });

  it('says not found for a character the armory does not have', async () => {
    profile = () => json({ code: 404 }, 404);
    await assert.rejects(
      service.lookup('Nobody'),
      (e: ArmoryError) =>
        e.failure === 'not-found' && /No character called Nobody.*Wild Growth/.test(e.message),
    );
  });

  it('is unavailable when Blizzard fails, refuses the client, cannot be reached or answers oddly', async () => {
    profile = () => json({}, 503);
    await assert.rejects(service.lookup('Susaru'), (e: ArmoryError) => e.failure === 'unavailable');
    profile = () => json({ name: 'Susaru' });
    await assert.rejects(service.lookup('Susaru'), /did not have the character/);
    token = () => json({}, 401);
    const fresh = new ArmoryService({
      get: (k: string) => env[k] ?? 'x',
    } as unknown as ConfigService);
    fresh.fetcher = service.fetcher;
    await assert.rejects(fresh.lookup('Susaru'), /Check the Battle.net client id and secret/);
    const down = new ArmoryService({ get: () => 'x' } as unknown as ConfigService);
    down.fetcher = async () => {
      throw new Error('ECONNRESET');
    };
    await assert.rejects(down.lookup('Susaru'), (e: ArmoryError) => e.failure === 'unavailable');
  });
});

describe('ArmoryController', () => {
  const req = { user: { id: 'u1' } } as AuthenticatedRequest;
  let officer: boolean;
  let outcome: () => Promise<unknown>;
  let controller: ArmoryController;

  beforeEach(() => {
    officer = true;
    outcome = async () => ({ name: 'Susaru' });
    controller = new ArmoryController(
      { lookup: () => outcome() } as unknown as ArmoryService,
      {
        assertOfficer: async () => {
          if (!officer) throw new ForbiddenException();
        },
      } as unknown as GuildAccessService,
    );
  });

  it('is for Officers only', async () => {
    assert.deepEqual(await controller.character(req, 'g', 'Susaru'), { name: 'Susaru' });
    officer = false;
    await assert.rejects(controller.character(req, 'g', 'Susaru'), ForbiddenException);
  });

  it('answers 404, 503 and 502 for not found, not set up and unavailable', async () => {
    outcome = async () => Promise.reject(new ArmoryError('not-found', 'x'));
    await assert.rejects(controller.character(req, 'g', 'x'), NotFoundException);
    outcome = async () => Promise.reject(new ArmoryError('not-configured', 'x'));
    await assert.rejects(controller.character(req, 'g', 'x'), ServiceUnavailableException);
    outcome = async () => Promise.reject(new ArmoryError('unavailable', 'x'));
    await assert.rejects(controller.character(req, 'g', 'x'), BadGatewayException);
  });
});
