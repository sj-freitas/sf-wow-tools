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
import type { PrismaService } from '../database/prisma.service';
import { ArmoryLookupService } from './armory-lookup.service';
import type { ArmoryRosterService } from './armory-roster.service';
import { ArmoryController } from './armory.controller';
import { ArmoryError, ArmoryService } from './armory.service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// As Forever's armory answers: a last name and a rule set, no realm.
const PROFILE = {
  name: 'Susaru',
  surname: 'Moonbrook',
  faction: { name: 'Alliance' },
  race: { name: 'Night Elf' },
  character_class: { name: 'Druid' },
  ruleset: { name: 'Roleplay' },
  level: 60,
};

/** A lookup in Forever's EU armory. */
const q = (name: string, lastName = 'Moonbrook', region = 'EU') => ({
  namespace: `profile-forever-${region.toLowerCase()}`,
  region,
  name,
  lastName,
});

describe('ArmoryService', () => {
  let env: Record<string, string | undefined>;
  let calls: { url: string; init?: RequestInit }[];
  let profile: () => Response;
  let specializations: () => Response;
  let token: () => Response;
  let service: ArmoryService;

  beforeEach(() => {
    env = { BLIZZARD_CLIENT_ID: 'id', BLIZZARD_CLIENT_SECRET: 'secret' };
    calls = [];
    profile = () => json(PROFILE);
    specializations = () => json({}, 404);
    token = () => json({ access_token: 'tok', expires_in: 86399 });
    service = new ArmoryService({ get: (key: string) => env[key] } as unknown as ConfigService);
    service.fetcher = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      if (url.includes('oauth.battle.net')) return token();
      return url.includes('/specializations?') ? specializations() : profile();
    };
  });

  it('logs in with the client (no player) and asks for the character by its full name, in its region', async () => {
    assert.deepEqual(await service.lookup(q('Susaru')), {
      name: 'Susaru Moonbrook',
      class: 'Druid',
      race: 'Night Elf',
      level: 60,
      faction: 'Alliance',
      realm: 'Roleplay',
      talents: null,
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
      'https://eu.api.blizzard.com/profile/wow/character/susaru-moonbrook?namespace=profile-forever-eu&locale=en_GB',
    );
    assert.equal((lookup.init?.headers as Record<string, string>).Authorization, 'Bearer tok');
  });

  it('asks the US armory in US English for a US guild, and a version without last names by name', async () => {
    await service.lookup(q('Susaru', 'Moonbrook', 'US'));
    assert.equal(
      calls[1].url,
      'https://us.api.blizzard.com/profile/wow/character/susaru-moonbrook?namespace=profile-forever-us&locale=en_US',
    );
    await service.lookup(q('Susaru', ''));
    assert.match(calls.at(-2)?.url ?? '', /\/character\/susaru\?namespace=/);
  });

  it('reads the talent builds (EXPERIMENTAL), the active one marked', async () => {
    specializations = () =>
      json({
        specialization_groups: [
          {
            is_active: true,
            specializations: [
              { specialization_name: 'Balance', spent_points: 0 },
              { specialization_name: 'Feral Combat', spent_points: 31 },
              { specialization_name: 'Restoration', spent_points: 20 },
            ],
          },
          {
            is_active: false,
            specializations: [{ specialization_name: 'Restoration', spent_points: 41 }],
          },
        ],
      });
    const found = await service.lookup(q('Susaru'));
    assert.equal(
      calls[2].url,
      'https://eu.api.blizzard.com/profile/wow/character/susaru-moonbrook/specializations?namespace=profile-forever-eu&locale=en_GB',
    );
    assert.deepEqual(found.talents, [
      {
        active: true,
        trees: [
          { name: 'Balance', points: 0 },
          { name: 'Feral Combat', points: 31 },
          { name: 'Restoration', points: 20 },
        ],
      },
      { active: false, trees: [{ name: 'Restoration', points: 41 }] },
    ]);
  });

  it('still finds the character when its talents cannot be read', async () => {
    specializations = () => json({}, 503);
    assert.equal((await service.lookup(q('Susaru'))).talents, null);
    specializations = () =>
      json({ specializations: [{ specialization_name: 'Fury', spent_points: 5 }] });
    assert.deepEqual((await service.lookup(q('Susaru'))).talents, [
      { active: true, trees: [{ name: 'Fury', points: 5 }] },
    ]);
  });

  it('keeps the token, so a second lookup does not log in again', async () => {
    await service.lookup(q('Susaru'));
    await service.lookup(q('Blomio'));
    assert.equal(calls.filter((c) => c.url.includes('oauth')).length, 1);
  });

  it('gets a new token once when the armory refuses the old one', async () => {
    await service.lookup(q('Susaru'));
    let refused = true;
    profile = () => {
      const answer = refused ? json({}, 401) : json(PROFILE);
      refused = false;
      return answer;
    };
    assert.equal((await service.lookup(q('Susaru'))).name, 'Susaru Moonbrook');
    assert.equal(calls.filter((c) => c.url.includes('oauth')).length, 2);
  });

  it('writes a name with accents into the address safely, lower case', async () => {
    await service.lookup(q('Jürgën', 'Ölm'));
    assert.match(calls[1].url, /character\/j%C3%BCrg%C3%ABn-%C3%B6lm\?/);
  });

  it('refuses names that are not a name, without asking anyone', async () => {
    for (const bad of ['', 'a', '../../x', 'name/ok', 'a b', 'x'.repeat(25), '1234']) {
      await assert.rejects(
        service.lookup(q(bad)),
        (e: ArmoryError) => e.failure === 'not-found',
        bad,
      );
      await assert.rejects(
        service.lookup(q('Susaru', bad === '' ? 'a' : bad)),
        (e: ArmoryError) => e.failure === 'not-found',
        `last name ${bad}`,
      );
    }
    await assert.rejects(
      service.lookup({ ...q('Susaru'), region: 'xx' }),
      (e: ArmoryError) => e.failure === 'not-configured',
    );
    await assert.rejects(
      service.lookup({ ...q('Susaru'), namespace: 'x&y' }),
      (e: ArmoryError) => e.failure === 'not-configured',
    );
    assert.deepEqual(calls, []);
  });

  it('says when the armory is not set up, without asking anyone', async () => {
    env = {};
    await assert.rejects(
      service.lookup(q('Susaru')),
      (e: ArmoryError) => e.failure === 'not-configured',
    );
    assert.deepEqual(calls, []);
    assert.equal(service.configured, false);
  });

  it('says not found for a character the armory does not have', async () => {
    profile = () => json({ code: 404 }, 404);
    await assert.rejects(
      service.lookup(q('Nobody')),
      (e: ArmoryError) =>
        e.failure === 'not-found' &&
        /No character called Nobody Moonbrook.*EU armory/.test(e.message),
    );
  });

  it('is unavailable when Blizzard fails, refuses the client, cannot be reached or answers oddly', async () => {
    profile = () => json({}, 503);
    await assert.rejects(
      service.lookup(q('Susaru')),
      (e: ArmoryError) => e.failure === 'unavailable',
    );
    profile = () => json({ name: 'Susaru' });
    await assert.rejects(service.lookup(q('Susaru')), /did not have the character/);
    token = () => json({}, 401);
    const fresh = new ArmoryService({
      get: (k: string) => env[k] ?? 'x',
    } as unknown as ConfigService);
    fresh.fetcher = service.fetcher;
    await assert.rejects(fresh.lookup(q('Susaru')), /Check the Battle.net client id and secret/);
    const down = new ArmoryService({ get: () => 'x' } as unknown as ConfigService);
    down.fetcher = async () => {
      throw new Error('ECONNRESET');
    };
    await assert.rejects(down.lookup(q('Susaru')), (e: ArmoryError) => e.failure === 'unavailable');
  });
});

describe('ArmoryService guild roster', () => {
  let calls: string[];
  let roster: () => Response;
  let classes: () => Response;
  let service: ArmoryService;

  beforeEach(() => {
    calls = [];
    // As Forever's armory answers: class and race by id, a last name, the rank as a number.
    roster = () =>
      json({
        guild: { name: 'Relic Hunters', faction: { type: 'ALLIANCE', name: 'Alliance' } },
        members: [
          {
            rank: 4,
            character: {
              name: 'Jo',
              surname: 'Mckenna',
              level: 16,
              playable_class: { id: 5 },
              playable_race: { id: 3 },
              faction: { type: 'ALLIANCE' },
            },
          },
          { rank: 0, character: { name: 'Lost', level: 3, playable_class: { id: 99 } } },
          { rank: 1, character: { surname: 'Nameless', level: 10 } },
        ],
      });
    classes = () => json({ classes: [{ id: 5, name: 'Priest' }] });
    service = new ArmoryService({
      get: (key: string) => ({ BLIZZARD_CLIENT_ID: 'id', BLIZZARD_CLIENT_SECRET: 's' })[key],
    } as unknown as ConfigService);
    service.fetcher = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes('oauth.battle.net')) return json({ access_token: 'tok', expires_in: 86399 });
      if (url.includes('/playable-class/')) return classes();
      if (url.includes('/playable-race/')) return json({ races: [{ id: 3, name: 'Dwarf' }] });
      return roster();
    };
  });

  const query = (guildName = 'Relic Hunters') => ({
    namespace: 'profile-forever-eu',
    region: 'EU',
    guildName,
  });

  it('reads the guild by its name, naming classes and races from the version’s game data', async () => {
    assert.deepEqual(await service.guildRoster(query()), {
      name: 'Relic Hunters',
      faction: 'Alliance',
      members: [
        {
          name: 'Jo',
          lastName: 'Mckenna',
          level: 16,
          class: 'Priest',
          race: 'Dwarf',
          faction: 'Alliance',
          rank: 4,
        },
        // An id the game data doesn't list leaves it empty; a member without a name is left out.
        { name: 'Lost', lastName: '', level: 3, class: '', race: '', faction: '', rank: 0 },
      ],
    });
    assert.ok(
      calls.includes(
        'https://eu.api.blizzard.com/data/wow/guild/relic-hunters/roster?namespace=profile-forever-eu&locale=en_GB',
      ),
    );
    assert.ok(
      calls.includes(
        'https://eu.api.blizzard.com/data/wow/playable-class/index?namespace=static-forever-eu&locale=en_GB',
      ),
    );
  });

  it('keeps the class and race names, so a second look asks only for the roster', async () => {
    await service.guildRoster(query());
    calls = [];
    await service.guildRoster(query());
    assert.deepEqual(
      calls.map((url) => url.split('?')[0]),
      ['https://eu.api.blizzard.com/data/wow/guild/relic-hunters/roster'],
    );
  });

  it('writes the name as the armory addresses it, and refuses one that is no guild name', async () => {
    await service.guildRoster(query("  Bob's   Ünion "));
    assert.ok(calls.some((url) => url.includes('/guild/bobs-%C3%BCnion/roster?')));
    calls = [];
    for (const bad of ['x', '../roster', 'Guild 42']) {
      await assert.rejects(
        service.guildRoster(query(bad)),
        (e: ArmoryError) => e.failure === 'not-found',
        bad,
      );
    }
    assert.deepEqual(calls, []);
  });

  it('says not found for a guild the armory does not have, unavailable when it fails', async () => {
    roster = () => json({ code: 404 }, 404);
    await assert.rejects(
      service.guildRoster(query('Nobody Here')),
      (e: ArmoryError) =>
        e.failure === 'not-found' && /No guild called Nobody Here/.test(e.message),
    );
    roster = () => json({}, 503);
    await assert.rejects(
      service.guildRoster(query()),
      (e: ArmoryError) => e.failure === 'unavailable',
    );
    classes = () => json({}, 500);
    roster = () => json({ members: [] });
    await assert.rejects(
      service.guildRoster(query()),
      (e: ArmoryError) => e.failure === 'unavailable',
    );
  });

  it('says when the armory is not set up, without asking anyone', async () => {
    const bare = new ArmoryService({ get: () => undefined } as unknown as ConfigService);
    bare.fetcher = service.fetcher;
    await assert.rejects(
      bare.guildRoster(query()),
      (e: ArmoryError) => e.failure === 'not-configured',
    );
    assert.deepEqual(calls, []);
  });
});

describe('ArmoryController', () => {
  const req = { user: { id: 'u1' } } as AuthenticatedRequest;
  let member: boolean;
  let guild: { gameVersion: string; region: string } | null;
  let asked: unknown[];
  let outcome: () => Promise<unknown>;
  let controller: ArmoryController;

  beforeEach(() => {
    member = true;
    guild = { gameVersion: 'Forever', region: 'EU' };
    asked = [];
    outcome = async () => ({ name: 'Susaru', class: 'Druid', talents: null });
    const lookup = new ArmoryLookupService(
      {
        lookup: (query: unknown) => {
          asked.push(query);
          return outcome();
        },
      } as unknown as ArmoryService,
      {
        find: async () => (member ? { isAdmin: false, isOfficer: false } : null),
      } as unknown as GuildAccessService,
      { guild: { findUnique: async () => guild } } as unknown as PrismaService,
    );
    controller = new ArmoryController(lookup, {} as ArmoryRosterService);
  });

  it('asks the armory of the guild’s version and region, and adds the specs worked out for it', async () => {
    const found = await controller.character(req, 'g', 'Susaru', 'Moonbrook');
    assert.deepEqual(asked, [
      { namespace: 'profile-forever-eu', region: 'EU', name: 'Susaru', lastName: 'Moonbrook' },
    ]);
    assert.equal(found.name, 'Susaru');
    // No talents: the class's first spec in Forever's config is assumed.
    assert.deepEqual(found.specs.main, {
      spec: 'Balance',
      role: 'RANGED_DPS',
      talentTree: null,
      points: null,
      guessed: true,
    });
  });

  it('is for anyone in the guild, not only Officers, and no one else', async () => {
    await controller.character(req, 'g', 'Susaru', 'Moonbrook');
    member = false;
    await assert.rejects(controller.character(req, 'g', 'Susaru'), ForbiddenException);
  });

  it('answers 503 for a version without an armory, without asking it', async () => {
    guild = { gameVersion: 'Nope', region: 'EU' };
    await assert.rejects(controller.character(req, 'g', 'Susaru'), ServiceUnavailableException);
    guild = null;
    await assert.rejects(controller.character(req, 'g', 'Susaru'), ServiceUnavailableException);
    assert.deepEqual(asked, []);
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
