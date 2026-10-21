import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { GuildAccessService } from '../auth/guild-access.service';
import type { PrismaService } from '../database/prisma.service';
import { GuildRecipesService } from './guild-recipes.service';
import type { ProfessionsPostPlugin } from './professions-post.plugin';
import { ProfessionsService } from './professions.service';
import { WowheadService } from './wowhead.service';

const FIXTURE = readFileSync(
  join(__dirname, '../../../../addons/dev/GuildAssistantProfessions/export.fixture.json'),
  'utf8',
);

/** An in-memory database, with Wowhead answering from `names` (and 404 for anything else). */
function setup(member = true) {
  const professions: Record<string, unknown>[] = [];
  const wowhead = new Map<string, Record<string, unknown>>();
  // Guilds whose Professions Lists were asked to post soon (after an import).
  const postedSoon: string[] = [];
  const prisma = {
    character: {
      findMany: async () => [
        { id: 'luna-id', firstName: 'Luna', lastName: 'Starfall', realm: 'Wild Growth' },
      ],
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'luna-id' ? { gameVersion: 'Forever' } : null,
    },
    characterGuildMembership: {
      findUnique: async () => ({ guild: { gameVersion: 'Forever' } }),
    },
    guild: {
      findUnique: async () => ({ gameVersion: 'Forever' }),
      findFirst: async ({ where }: { where: { servers: { some: { discordId: string } } } }) =>
        where.servers.some.discordId === 'server-1' ? { id: 'g1' } : null,
    },
    characterProfession: {
      deleteMany: ({ where }: { where: { characterId: string } }) => {
        for (let i = professions.length - 1; i >= 0; i--) {
          if (professions[i].characterId === where.characterId) professions.splice(i, 1);
        }
        return Promise.resolve();
      },
      createMany: ({ data }: { data: Record<string, unknown>[] }) => {
        professions.push(...data.map((row) => ({ ...row, importedAt: new Date() })));
        return Promise.resolve();
      },
      findMany: async () =>
        professions.map((row) => ({
          ...row,
          character: {
            id: row.characterId,
            firstName: 'Luna',
            lastName: 'Starfall',
            class: 'MAGE',
            player: { discordUserId: 'd1' },
          },
        })),
    },
    wowheadEntry: {
      findMany: async () => [...wowhead.values()],
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        wowhead.set(`${String(create.kind)}:${String(create.id)}`, create);
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaService;
  const access = { find: async () => (member ? { isAdmin: false, isOfficer: false } : null) };
  const names: Record<string, string> = { 'spell/20034': 'Enchant Weapon - Crusader' };
  const wowheadService = new WowheadService(prisma);
  const asked: string[] = [];
  wowheadService.fetcher = (async (url: string) => {
    const key = url.replace(/^.*tooltip\//, '');
    asked.push(url.replace('https://nether.wowhead.com/', ''));
    return names[key]
      ? new Response(JSON.stringify({ name: names[key], icon: 'spell_holy_greaterheal' }))
      : new Response('{"error":"not found"}', { status: 404 });
  }) as typeof fetch;
  const service = new ProfessionsService(
    prisma,
    access as unknown as GuildAccessService,
    wowheadService,
    new GuildRecipesService(prisma, wowheadService),
    {
      soon: async (guildId: string) => void postedSoon.push(guildId),
    } as unknown as ProfessionsPostPlugin,
  );
  return { service, professions, wowhead, asked, wowheadService, postedSoon };
}

const user = { id: 'u1', discordId: 'd1' };

describe('ProfessionsService', () => {
  it("imports the export into the user's matching characters and skips the others", async () => {
    const { service, professions } = setup();
    const result = await service.import(user, 'g1', FIXTURE);
    assert.deepEqual(result.skipped, [{ name: 'Bob', realm: 'Wild Growth' }]);
    // Someone else's, seen through a profession link: listed, not imported (nor matched by name).
    assert.deepEqual(result.linked, [{ name: 'Mira', realm: 'Wild Growth' }]);
    assert.deepEqual(result.imported, [
      {
        characterId: 'luna-id',
        name: 'Luna-Starfall',
        professions: [
          { name: 'Enchanting', recipes: 2 },
          { name: 'Tailoring', recipes: 2 },
        ],
      },
    ]);
    assert.deepEqual(
      professions.map((p) => [p.name, p.spellIds, p.itemIds]),
      [
        ['Enchanting', [13890, 20034], []],
        ['Tailoring', [18560], [14146]],
      ],
    );
  });

  it("has the guild's Professions Lists post the change soon after an import", async () => {
    const { service, postedSoon } = setup();
    await service.import(user, 'g1', FIXTURE);
    assert.deepEqual(postedSoon, ['g1']);
  });

  it('replaces what was imported before', async () => {
    const { service, professions } = setup();
    await service.import(user, 'g1', FIXTURE);
    await service.import(user, 'g1', FIXTURE);
    assert.equal(professions.length, 2);
  });

  it("lists recipes with Wowhead's names and links in the guild's game version", async () => {
    const { service, wowheadService } = setup();
    await service.import(user, 'g1', FIXTURE);
    // The import looks names up in the background; wait for it.
    await wowheadService.resolve([{ kind: 'SPELL', id: 20034 }], 'forever');
    const [enchanting] = await service.list('u1', 'g1', 'luna-id');
    const crusader = enchanting.recipes.find((recipe) => recipe.id === 20034)!;
    assert.equal(crusader.name, 'Enchant Weapon - Crusader');
    assert.equal(
      crusader.url,
      'https://www.wowhead.com/forever/spell=20034/enchant-weapon-crusader',
    );
    const unknown = enchanting.recipes.find((recipe) => recipe.id === 13890)!;
    assert.equal(unknown.name, null);
    assert.equal(unknown.url, 'https://www.wowhead.com/forever/spell=13890');
  });

  it("lists the guild's recipes with who can craft them", async () => {
    const { service, wowheadService } = setup();
    await service.import(user, 'g1', FIXTURE);
    await wowheadService.resolve([{ kind: 'SPELL', id: 20034 }], 'forever');
    const guild = await service.guild('u1', 'g1');
    assert.deepEqual(
      guild.characters.map((c) => [c.name, c.class, c.professions.map((p) => p.name)]),
      [['Luna Starfall', 'MAGE', ['Enchanting', 'Tailoring']]],
    );
    assert.deepEqual(
      guild.recipes.map((r) => [r.profession, r.kind, r.id, r.name, r.crafterIds]),
      [
        ['Enchanting', 'spell', 20034, 'Enchant Weapon - Crusader', ['luna-id']],
        ['Enchanting', 'spell', 13890, null, ['luna-id']],
        // Not named by Wowhead (yet): last, by id.
        ['Tailoring', 'item', 14146, null, ['luna-id']],
        ['Tailoring', 'spell', 18560, null, ['luna-id']],
      ],
    );
    assert.equal(
      guild.recipes[0].url,
      'https://www.wowhead.com/forever/spell=20034/enchant-weapon-crusader',
    );
  });

  it('finds who can craft a recipe by name (typos too), id or Wowhead link', async () => {
    const { service, wowheadService } = setup();
    await service.import(user, 'g1', FIXTURE);
    await wowheadService.resolve([{ kind: 'SPELL', id: 20034 }], 'forever');
    const luna = [{ name: 'Luna Starfall', discordUserId: 'd1' }];
    const byName = await service.findCrafters('server-1', 'crusadr');
    assert.deepEqual(byName, {
      matches: [
        {
          name: 'Enchant Weapon - Crusader',
          url: 'https://www.wowhead.com/forever/spell=20034/enchant-weapon-crusader',
          profession: 'Enchanting',
          crafters: luna,
        },
      ],
      more: 0,
    });
    const byId = await service.findCrafters('server-1', '14146');
    assert.deepEqual(
      byId?.matches.map((m) => [m.name, m.profession]),
      [['Item 14146', 'Tailoring']],
    );
    const byLink = await service.findCrafters(
      'server-1',
      'https://www.wowhead.com/forever/spell=18560/mooncloth',
    );
    assert.deepEqual(
      byLink?.matches.map((m) => m.name),
      ['Spell 18560'],
    );
    assert.deepEqual(await service.findCrafters('server-1', 'thorium'), { matches: [], more: 0 });
    assert.equal(await service.findCrafters('other-server', 'crusader'), null);
  });

  it("lists a character's professions for its own page, without a guild", async () => {
    const { service } = setup();
    await service.import(user, 'g1', FIXTURE);
    const professions = await service.forCharacter('luna-id');
    assert.deepEqual(
      professions.map((p) => [p.name, p.recipes.length]),
      [
        ['Enchanting', 2],
        ['Tailoring', 2],
      ],
    );
    assert.match(professions[0].recipes[0].url, /^https:\/\/www\.wowhead\.com\/forever\//);
    await assert.rejects(service.forCharacter('nobody'), /Character not found/);
  });

  it('keeps people outside the guild out', async () => {
    const { service } = setup(false);
    await assert.rejects(service.import(user, 'g1', FIXTURE), /not a member/);
    await assert.rejects(service.list('u1', 'g1', 'luna-id'), /not a member/);
    await assert.rejects(service.guild('u1', 'g1'), /not a member/);
  });
});

describe('WowheadService', () => {
  it('looks each id up once, and marks the ones Wowhead has not got', async () => {
    const { wowheadService, wowhead, asked } = setup();
    const refs = [
      { kind: 'SPELL' as const, id: 20034 },
      { kind: 'SPELL' as const, id: 99999 },
    ];
    await wowheadService.resolve(refs, 'forever');
    await wowheadService.resolve(refs, 'forever');
    // In the guild's game version's data: Forever's own spells aren't in Classic's.
    assert.deepEqual(asked.sort(), ['forever/tooltip/spell/20034', 'forever/tooltip/spell/99999']);
    assert.equal(wowhead.get('SPELL:20034')?.englishName, 'Enchant Weapon - Crusader');
    assert.equal(wowhead.get('SPELL:99999')?.missing, true);
  });
});
