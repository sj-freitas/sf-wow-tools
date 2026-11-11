import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import { RecipeSourcesController, RecipeSourcesService } from './recipe-sources.service';

interface Stored {
  kind: 'ITEM' | 'TRAINER';
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
  const same = (
    a: Pick<Stored, 'kind' | 'key' | 'entry'>,
    b: Pick<Stored, 'kind' | 'key' | 'entry'>,
  ) => a.kind === b.kind && a.key === b.key && a.entry === b.entry;
  const prisma = {
    recipeSource: {
      findMany: async (args?: { where?: { OR: Pick<Stored, 'kind' | 'key' | 'entry'>[] } }) =>
        args?.where
          ? rows.filter((row) => args.where!.OR.some((wanted) => same(row, wanted)))
          : [...rows],
      createMany: async ({ data }: { data: Stored[] }) => {
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
        const row = rows.find((r) => same(r, where.kind_key_entry))!;
        Object.assign(row, data);
        return row;
      },
    },
  } as unknown as PrismaService;
  const service = new RecipeSourcesService(prisma);
  let clock = Date.parse('2026-11-11T12:00:00Z');
  service.now = () => new Date(clock);
  return { service, rows, later: () => (clock += 60_000) };
}

const sources = {
  items: [{ id: 6047, entries: ['V:Tanaris=Krinkle Goodsteel'] }],
  trainers: [{ recipe: 'item:2852', cost: 50, entries: ['Stormwind City=Grimand Elmore'] }],
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

  it("keeps a trainer's cost, unless an import doesn't say it", async () => {
    const { service, rows } = setup();
    await service.record('u1', sources);
    await service.record('u2', {
      items: [],
      trainers: [{ recipe: 'item:2852', cost: null, entries: ['Stormwind City=Grimand Elmore'] }],
    });
    assert.equal(rows.find((row) => row.kind === 'TRAINER')!.cost, 50);
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
      published.trainers.map((t) => [t.recipe, t.cost, t.entries.length]),
      [['item:2852', 50, 1]],
    );
  });
});
