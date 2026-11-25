import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import { RecipeSourcesController, RecipeSourcesService } from './recipe-sources.service';

interface Stored {
  kind: 'ITEM' | 'TRAINER' | 'REQUIREMENT';
  key: string;
  entry: string;
  cost: number | null;
  reporters: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** The recipe_sources table, in memory. */
function setup() {
  const rows: Stored[] = [];
  /** Each query made, by name: what an import costs is how many of these it makes. */
  const statements: string[] = [];
  const same = (
    a: Pick<Stored, 'kind' | 'key' | 'entry'>,
    b: Pick<Stored, 'kind' | 'key' | 'entry'>,
  ) => a.kind === b.kind && a.key === b.key && a.entry === b.entry;
  const prisma = {
    recipeSource: {
      findMany: async (args?: { where?: { OR: Pick<Stored, 'kind' | 'key' | 'entry'>[] } }) => {
        statements.push('findMany');
        return args?.where
          ? rows.filter((row) => args.where!.OR.some((wanted) => same(row, wanted)))
          : [...rows];
      },
      createMany: async ({ data }: { data: Stored[] }) => {
        statements.push('createMany');
        rows.push(...data.map((row) => ({ ...row })));
        return { count: data.length };
      },
      update: async ({
        where,
        data,
      }: {
        where: { kind_key_entry: Stored };
        data: Partial<Stored>;
      }) => {
        statements.push('update');
        const row = rows.find((r) => same(r, where.kind_key_entry))!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { OR: Pick<Stored, 'kind' | 'key' | 'entry'>[] };
        data: Partial<Stored>;
      }) => {
        statements.push('updateMany');
        const hit = rows.filter((row) => where.OR.some((wanted) => same(row, wanted)));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
    },
  } as unknown as PrismaService;
  const service = new RecipeSourcesService(prisma);
  let clock = Date.parse('2026-11-11T12:00:00Z');
  service.now = () => new Date(clock);
  return { service, rows, statements, later: () => (clock += 60_000) };
}

const sources = {
  items: [{ id: 6047, entries: ['V:Tanaris=Krinkle Goodsteel'] }],
  trainers: [
    { recipe: 'item:2852', cost: 50, entries: ['Stormwind City=Grimand Elmore'], requires: [] },
  ],
};

describe('RecipeSourcesService', () => {
  it('keeps what an import carries, and counts who reported each, once each', async () => {
    const { service, rows, later } = setup();
    assert.equal(await service.record('u1', sources), 2);
    assert.equal(await service.record('u1', null), 0);
    later();
    // Another user reports the vendor again and a new place; the first user again changes nothing new.
    assert.equal(
      await service.record('u2', {
        items: [{ id: 6047, entries: ['V:Tanaris=Krinkle Goodsteel', 'V:Booty Bay=Narkk'] }],
        trainers: [],
      }),
      1,
    );
    assert.equal(await service.record('u1', sources), 0);
    const krinkle = rows.find((row) => row.entry === 'V:Tanaris=Krinkle Goodsteel')!;
    assert.deepEqual(krinkle.reporters, ['u1', 'u2']);
    assert.ok(krinkle.lastSeenAt > krinkle.firstSeenAt);
  });

  it('says it has seen the sources it already knows in one statement, not one each', async () => {
    const { service, statements } = setup();
    const many = {
      items: Array.from({ length: 40 }, (_, i) => ({
        id: 1000 + i,
        entries: [`V:Tanaris=Vendor ${i}`],
      })),
      trainers: [],
    };
    assert.equal(await service.record('u1', many), 40);
    statements.length = 0;
    // The same export again, as the game saves it every few minutes: nothing new in it. A guild
    // that has played a while carries thousands of these, and a statement each outlasted the
    // uploader's wait for an answer.
    assert.equal(await service.record('u1', many), 0);
    assert.deepEqual(statements, ['findMany', 'updateMany']);
  });

  it("keeps a trainer's cost, unless an import doesn't say it", async () => {
    const { service, rows } = setup();
    await service.record('u1', sources);
    await service.record('u2', {
      items: [],
      trainers: [
        {
          recipe: 'item:2852',
          cost: null,
          entries: ['Stormwind City=Grimand Elmore'],
          requires: [],
        },
      ],
    });
    assert.equal(rows.find((row) => row.kind === 'TRAINER')!.cost, 50);
  });

  it('keeps what a recipe requires, as rows of their own, and publishes it with its trainers', async () => {
    const { service, rows } = setup();
    const mortar = {
      recipe: 'item:10577',
      cost: 2800,
      entries: ['Tanaris=Nixx Sprocketspring'],
      requires: ['Goblin Engineer'],
    };
    assert.equal(await service.record('u1', { items: [], trainers: [mortar] }), 2);
    assert.equal(await service.record('u2', { items: [], trainers: [mortar] }), 0);
    const requirement = rows.find((row) => row.kind === 'REQUIREMENT')!;
    assert.deepEqual(
      [requirement.key, requirement.entry, requirement.cost, requirement.reporters],
      ['item:10577', 'Goblin Engineer', null, ['u1', 'u2']],
    );
    const published = await service.published();
    assert.deepEqual(
      published.trainers.map((t) => [
        t.recipe,
        t.cost,
        t.entries.map((e) => e.entry),
        t.requires.map((e) => `${e.entry} (${e.reporters})`),
      ]),
      [['item:10577', 2800, ['Tanaris=Nixx Sprocketspring'], ['Goblin Engineer (2)']]],
    );
  });

  it('publishes everything gathered, by item and by recipe', async () => {
    const { service } = setup();
    await service.record('u1', sources);
    await service.record('u2', {
      items: [
        { id: 2881, entries: ['D:Westfall=Defias Renegade Mage'] },
        { id: 6047, entries: ['V:Tanaris=Krinkle Goodsteel'] },
      ],
      trainers: [],
    });
    const published = await new RecipeSourcesController(service).list();
    assert.deepEqual(
      published.items.map((item) => [
        item.id,
        item.entries.map((e) => `${e.entry} (${e.reporters})`),
      ]),
      [
        [2881, ['D:Westfall=Defias Renegade Mage (1)']],
        [6047, ['V:Tanaris=Krinkle Goodsteel (2)']],
      ],
    );
    assert.deepEqual(
      published.trainers.map((t) => [t.recipe, t.cost, t.entries.length, t.requires.length]),
      [['item:2852', 50, 1, 0]],
    );
  });
});
