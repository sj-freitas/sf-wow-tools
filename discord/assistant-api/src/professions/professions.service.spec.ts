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
function setup(member = true, officer = false) {
  // When a drop happens (the fake database's clock), in ms.
  const clock = { now: Date.parse('2026-10-20T12:00:00Z') };
  const professions: Record<string, unknown>[] = [];
  const drops: { characterId: string; name: string; droppedAt: Date }[] = [];
  const snapshots = new Map<string, Date>();
  // Luna is the user's; Kael a guildmate's (on the guild's roster, played by d2).
  const people: Record<
    string,
    { firstName: string; lastName: string; class: string; player: string }
  > = {
    'luna-id': { firstName: 'Luna', lastName: 'Starfall', class: 'MAGE', player: 'd1' },
    'kael-id': { firstName: 'Kael', lastName: '', class: 'PRIEST', player: 'd2' },
  };
  const wowhead = new Map<string, Record<string, unknown>>();
  // Guilds whose Professions Lists were asked to post soon (after an import).
  const postedSoon: string[] = [];
  const prisma = {
    character: {
      // The user's own characters (`player`), or the guild's whole roster.
      findMany: async ({ where }: { where: { player?: unknown } }) =>
        Object.entries(people)
          .filter(([, person]) => !where.player || person.player === 'd1')
          .map(([id, person]) => ({
            id,
            firstName: person.firstName,
            lastName: person.lastName,
            realm: 'Wild Growth',
          })),
      // Luna: played by d1, in guild g1.
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'luna-id'
          ? {
              gameVersion: 'Forever',
              player: { discordUserId: 'd1' },
              guilds: [{ guildId: 'g1' }],
            }
          : null,
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
      deleteMany: ({ where }: { where: { characterId: string; name?: string } }) => {
        let count = 0;
        for (let i = professions.length - 1; i >= 0; i--) {
          const row = professions[i];
          if (row.characterId !== where.characterId) continue;
          if (where.name !== undefined && row.name !== where.name) continue;
          professions.splice(i, 1);
          count++;
        }
        return Promise.resolve({ count });
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { characterId_name: { characterId: string; name: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const { characterId, name } = where.characterId_name;
        const row = professions.find((p) => p.characterId === characterId && p.name === name);
        if (row) Object.assign(row, update);
        else professions.push({ ...create });
      },
      findMany: async (args?: { where?: { characterId?: string } }) =>
        professions
          .filter((row) => !args?.where?.characterId || row.characterId === args.where.characterId)
          .map((row) => {
            const person = people[row.characterId as string];
            return {
              ...row,
              character: {
                id: row.characterId,
                firstName: person.firstName,
                lastName: person.lastName,
                class: person.class,
                player: { discordUserId: person.player },
              },
            };
          }),
    },
    professionSnapshot: {
      findUnique: async ({ where }: { where: { characterId: string } }) =>
        snapshots.has(where.characterId)
          ? { characterId: where.characterId, takenAt: snapshots.get(where.characterId) }
          : null,
      upsert: async ({ create }: { create: { characterId: string; takenAt: Date } }) =>
        void snapshots.set(create.characterId, create.takenAt),
    },
    professionDrop: {
      findMany: async ({
        where,
        orderBy,
        skip,
      }: {
        where: { characterId: string };
        orderBy?: unknown;
        skip?: number;
      }) => {
        const list = drops.filter((d) => d.characterId === where.characterId);
        if (orderBy) list.sort((a, b) => b.droppedAt.getTime() - a.droppedAt.getTime());
        return list.slice(skip ?? 0);
      },
      upsert: async ({
        create,
      }: {
        create: { characterId: string; name: string; droppedAt: Date };
      }) => {
        const found = drops.find(
          (d) => d.characterId === create.characterId && d.name === create.name,
        );
        if (found) found.droppedAt = create.droppedAt;
        else drops.push({ ...create });
      },
      delete: async ({
        where,
      }: {
        where: { characterId_name: { characterId: string; name: string } };
      }) => {
        const { characterId, name } = where.characterId_name;
        drops.splice(
          drops.findIndex((d) => d.characterId === characterId && d.name === name),
          1,
        );
      },
      deleteMany: async ({ where }: { where: { characterId: string; name: { in: string[] } } }) => {
        for (const name of where.name.in) {
          drops.splice(
            drops.findIndex((d) => d.characterId === where.characterId && d.name === name),
            1,
          );
        }
      },
    },
    wowheadEntry: {
      findMany: async () => [...wowhead.values()],
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        wowhead.set(`${String(create.kind)}:${String(create.id)}`, create);
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaService;
  const access = { find: async () => (member ? { isAdmin: false, isOfficer: officer } : null) };
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
  service.now = () => new Date(clock.now);
  return { service, professions, drops, clock, wowhead, asked, wowheadService, postedSoon };
}

const user = { id: 'u1', discordId: 'd1' };

/** Seconds (the addon's dates) for a day of October 2026. */
const day = (d: number) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T12:00:00Z`) / 1000;

/** An export (1.0's format) with one character, as of `updated` (seconds). */
function exportOf(
  name: string,
  source: 'own' | 'guild',
  updated: number,
  professions: {
    name: string;
    skill?: number;
    spells: number[];
    learned?: number;
    updated?: number;
  }[],
): string {
  return JSON.stringify({
    addon: 'GuildAssistantProfessions',
    format: 2,
    characters: [
      {
        name,
        realm: 'Wild Growth',
        source,
        updated,
        professions: professions.map((p) => ({ max: 300, items: [], ...p })),
      },
    ],
  });
}

describe('ProfessionsService', () => {
  it("imports the user's characters, and the guildmates' their addon received", async () => {
    const { service, professions } = setup();
    const result = await service.import(user, 'g1', FIXTURE);
    // Bob is "own" but not one of the user's characters in this guild.
    assert.deepEqual(result.skipped, [{ name: 'Bob', realm: 'Wild Growth' }]);
    // Someone else's, seen through a profession link: listed, not imported (nor matched by name).
    assert.deepEqual(result.linked, [{ name: 'Mira', realm: 'Wild Growth' }]);
    assert.deepEqual(result.imported, [
      // A guildmate's, shared by their addon: any character on the guild's roster.
      {
        characterId: 'kael-id',
        name: 'Kael',
        relayed: true,
        professions: [{ name: 'Herbalism', recipes: 1 }],
      },
      {
        characterId: 'luna-id',
        name: 'Luna-Starfall',
        relayed: false,
        professions: [
          { name: 'Enchanting', recipes: 2 },
          { name: 'Tailoring', recipes: 2 },
        ],
      },
    ]);
    assert.deepEqual(
      professions.map((p) => [p.characterId, p.name, p.spellIds, p.itemIds]),
      [
        ['kael-id', 'Herbalism', [2366], []],
        ['luna-id', 'Enchanting', [13890, 20034], []],
        ['luna-id', 'Tailoring', [18560], [14146]],
      ],
    );
    // The addon's history of the profession (1.0+).
    assert.equal(
      (professions[0].learnedAt as Date).toISOString(),
      new Date(1791000000 * 1000).toISOString(),
    );
  });

  it("has the guild's Professions Lists post the change soon after an import", async () => {
    const { service, postedSoon } = setup();
    await service.import(user, 'g1', FIXTURE);
    assert.deepEqual(postedSoon, ['g1']);
  });

  it('merges with what was imported before: recipes are added, never removed', async () => {
    const { service, professions } = setup();
    await service.import(user, 'g1', FIXTURE);
    await service.import(user, 'g1', FIXTURE);
    assert.equal(professions.length, 3, 'the same again: nothing doubled');
    // A newer file: Enchanting with fewer recipes, Tailoring with one more and a lower skill.
    await service.import(
      user,
      'g1',
      exportOf('Luna', 'own', day(5), [
        { name: 'Enchanting', spells: [20034] },
        { name: 'Tailoring', skill: 100, spells: [2387] },
      ]),
    );
    const luna = professions.filter((p) => p.characterId === 'luna-id');
    assert.deepEqual(
      luna.map((p) => [p.name, p.spellIds, p.skill]),
      [
        ['Enchanting', [13890, 20034], 300],
        ['Tailoring', [2387, 18560], 280],
      ],
    );
  });

  it('leaves out characters from an addon before 1.0, quietly', async () => {
    const { service, professions } = setup();
    const old = JSON.parse(FIXTURE) as { format: number };
    old.format = 1;
    const result = await service.import(user, 'g1', JSON.stringify(old));
    assert.deepEqual(
      result.outdated.map((c) => c.name),
      ['Bob', 'Kael', 'Luna'],
    );
    assert.equal(result.imported.length, 0);
    assert.equal(professions.length, 0, 'nothing imported, and no error');
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
      [
        ['Kael', 'PRIEST', ['Herbalism']],
        ['Luna Starfall', 'MAGE', ['Enchanting', 'Tailoring']],
      ],
    );
    assert.deepEqual(
      guild.recipes.map((r) => [r.profession, r.kind, r.id, r.name, r.crafterIds]),
      [
        ['Enchanting', 'spell', 20034, 'Enchant Weapon - Crusader', ['luna-id']],
        ['Enchanting', 'spell', 13890, null, ['luna-id']],
        ['Herbalism', 'spell', 2366, null, ['kael-id']],
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

  describe('dropping a profession', () => {
    const other = { id: 'u2', discordId: 'd2' };

    it('lets its player drop a main profession, with its recipes', async () => {
      const { service, professions, postedSoon } = setup();
      await service.import(user, 'g1', FIXTURE);
      postedSoon.length = 0;
      await service.drop(user, 'luna-id', 'Tailoring');
      assert.deepEqual(
        professions.filter((p) => p.characterId === 'luna-id').map((p) => p.name),
        ['Enchanting'],
      );
      assert.deepEqual(postedSoon, ['g1'], "the guild's Professions List posts the change");
    });

    it('lets an Officer of its guild drop one, but nobody else', async () => {
      const outsider = setup(true, false);
      await outsider.service.import(user, 'g1', FIXTURE);
      await assert.rejects(outsider.service.drop(other, 'luna-id', 'Tailoring'), /Only its player/);
      assert.equal(outsider.professions.length, 3);

      const officer = setup(true, true);
      await officer.service.import(user, 'g1', FIXTURE);
      await officer.service.drop(other, 'luna-id', 'Tailoring');
      assert.equal(officer.professions.length, 2);
    });

    it("doesn't bring a dropped profession back from an older copy", async () => {
      const { service, professions } = setup();
      await service.import(user, 'g1', FIXTURE);
      await service.drop(user, 'luna-id', 'Tailoring');
      const result = await service.import(user, 'g1', FIXTURE);
      assert.equal(
        professions.some((p) => p.characterId === 'luna-id' && p.name === 'Tailoring'),
        false,
        'still dropped',
      );
      assert.deepEqual(result.dropped, [
        {
          characterId: 'luna-id',
          name: 'Luna-Starfall',
          profession: 'Tailoring',
          droppedAt: '2026-10-20T12:00:00.000Z',
        },
      ]);
      // The rest of the file is imported as usual.
      assert.deepEqual(
        result.imported.find((c) => c.characterId === 'luna-id')?.professions.map((p) => p.name),
        ['Enchanting'],
      );
    });

    it('brings it back when the file says it was learned again after the drop', async () => {
      const { service, professions, drops } = setup();
      await service.import(user, 'g1', FIXTURE);
      await service.drop(user, 'luna-id', 'Tailoring');
      const result = await service.import(
        user,
        'g1',
        exportOf('Luna', 'own', day(21), [
          { name: 'Enchanting', spells: [20034] },
          { name: 'Tailoring', spells: [2387], learned: day(21) },
        ]),
      );
      assert.deepEqual(result.relearned, [
        { characterId: 'luna-id', name: 'Luna-Starfall', profession: 'Tailoring' },
      ]);
      assert.deepEqual(
        professions.find((p) => p.characterId === 'luna-id' && p.name === 'Tailoring')?.spellIds,
        [2387],
        'only what the file has: the old recipes went with the drop',
      );
      assert.equal(drops.length, 0, 'no longer a dropped profession');
    });

    it('replaces a main profession a newer file no longer has, whoever uploads it', async () => {
      const { service, professions, drops } = setup();
      await service.import(user, 'g1', FIXTURE);
      // Kael unlearned Herbalism and learned Mining: a guildmate's newer copy, uploaded by Luna's player.
      const result = await service.import(
        user,
        'g1',
        exportOf('Kael', 'guild', day(20), [{ name: 'Mining', spells: [2575], learned: day(19) }]),
      );
      assert.deepEqual(result.replaced, [
        { characterId: 'kael-id', name: 'Kael', profession: 'Herbalism' },
      ]);
      assert.deepEqual(
        professions.filter((p) => p.characterId === 'kael-id').map((p) => p.name),
        ['Mining'],
      );
      assert.deepEqual(
        drops.map((d) => [d.name, d.droppedAt.toISOString()]),
        [['Herbalism', new Date(day(20) * 1000).toISOString()]],
        "dropped as of the file's date",
      );
      // An older copy that still has Herbalism doesn't bring it back.
      await service.import(user, 'g1', FIXTURE);
      assert.equal(
        professions.some((p) => p.characterId === 'kael-id' && p.name === 'Herbalism'),
        false,
      );
    });

    it("an older file doesn't drop anything, and secondary professions are never dropped", async () => {
      const { service, professions } = setup();
      await service.import(
        user,
        'g1',
        exportOf('Luna', 'own', day(10), [
          { name: 'Tailoring', spells: [1] },
          { name: 'Cooking', spells: [2] },
        ]),
      );
      await service.import(
        user,
        'g1',
        exportOf('Luna', 'own', day(5), [{ name: 'Mining', spells: [3] }]),
      );
      assert.deepEqual(
        professions.map((p) => p.name).sort(),
        ['Cooking', 'Mining', 'Tailoring'],
        'older: only adds',
      );
      await service.import(
        user,
        'g1',
        exportOf('Luna', 'own', day(12), [{ name: 'Mining', spells: [3] }]),
      );
      assert.deepEqual(
        professions.map((p) => p.name).sort(),
        ['Cooking', 'Mining'],
        'newer: Tailoring replaced, Cooking (secondary) kept',
      );
    });

    it('remembers the last two dropped professions of a character', async () => {
      const { service, drops, clock } = setup();
      await service.import(
        user,
        'g1',
        exportOf('Luna', 'own', day(1), [
          { name: 'Tailoring', spells: [1] },
          { name: 'Mining', spells: [2] },
          { name: 'Herbalism', spells: [3] },
        ]),
      );
      for (const name of ['Tailoring', 'Mining', 'Herbalism']) {
        clock.now += 60_000;
        await service.drop(user, 'luna-id', name);
      }
      assert.deepEqual(drops.map((d) => d.name).sort(), ['Herbalism', 'Mining']);
    });

    it('refuses secondary professions, and ones it does not have', async () => {
      const { service } = setup();
      await service.import(user, 'g1', FIXTURE);
      await assert.rejects(service.drop(user, 'luna-id', 'Cooking'), /secondary profession/);
      await assert.rejects(service.drop(user, 'luna-id', 'Alchemy'), /no Alchemy/);
      await assert.rejects(service.drop(user, 'nobody', 'Tailoring'), /Character not found/);
    });
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
