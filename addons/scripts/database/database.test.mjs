// Tests of the database job (node:test; `npm test` runs them with the Lua specs). The fixture is a
// slice of the game's tables (dev/GuildAssistantDatabase/gamedata.fixture.mjs); Data.fixture.lua
// next to it is what it builds, which the addon's specs load. UPDATE_FIXTURES=1 rewrites it.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { meta, tables } from '../../dev/GuildAssistantDatabase/gamedata.fixture.mjs';
import { root } from '../addons.mjs';
import { parseCsv } from './csv.mjs';
import { buildDatabase, fetchTables, itemKind, itemStats, latestBuild, TABLES } from './gamedata.mjs';
import { EMPTY_FOUND, fetchFound, toFoundLua } from './found.mjs';
import { itemLine, longString, recipeLine, toLua, toRecipesLua } from './lua.mjs';

const FIXTURE_LUA = join(root, 'dev', 'GuildAssistantDatabase', 'Data.fixture.lua');
const RECIPES_FIXTURE_LUA = join(root, 'dev', 'GuildAssistantProfessions', 'Recipes.fixture.lua');

test('reads CSV as wago.tools writes it: quoted commas, doubled quotes, line breaks', () => {
  const rows = parseCsv('ID,Name,Note\r\n1,"A, B","say ""hi"""\n2,C,"two\nlines"\n');
  assert.deepEqual(rows, [
    { ID: '1', Name: 'A, B', Note: 'say "hi"' },
    { ID: '2', Name: 'C', Note: 'two\nlines' },
  ]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('ID,Name\n3'), [{ ID: '3', Name: '' }]);
});

test("names an item's slot and type, and its stats, as the game does", () => {
  assert.equal(itemKind({ InventoryType: '5' }, { ClassID: '4', SubclassID: '4' }), 'Chest (Plate)');
  assert.equal(itemKind({ InventoryType: '13' }, { ClassID: '2', SubclassID: '4' }), 'One-Hand (One-Handed Maces)');
  assert.equal(itemKind({ InventoryType: '0' }, { ClassID: '0', SubclassID: '1' }), 'Potion');
  assert.equal(itemKind(undefined, { InventoryType: '10', ClassID: '4', SubclassID: '4' }), 'Hands (Plate)', 'from Item alone');
  assert.equal(itemKind(undefined, undefined), '');
  assert.equal(itemStats({ StatModifier_bonusStat_0: '32', StatModifier_bonusStat_1: '13', StatModifier_bonusStat_2: '-1' }, { ClassID: '4' }),
    'Critical Strike Rating, Dodge Rating');
  assert.equal(itemStats({ ItemDelay: '2400', StatModifier_bonusStat_0: '-1' }, { ClassID: '2' }), 'Speed 2.40');
  assert.equal(itemStats({ ItemDelay: '2400' }, { ClassID: '4' }), '', 'only weapons have a speed');
});

test('builds each profession from the game tables: recipes, reagents, items, how they are learned', () => {
  const database = buildDatabase(tables, meta);
  assert.deepEqual(database.professions.map((p) => p.name), ['Blacksmithing', 'Enchanting']);
  const blacksmithing = database.professions[0];
  const byName = Object.fromEntries(blacksmithing.recipes.map((r) => [r.name, r]));
  // A rank (no reagents) isn't a recipe.
  assert.deepEqual(blacksmithing.recipes.map((r) => r.name), [
    'Copper Chain Pants', 'Rough Sharpening Stone', 'Runed Copper Breastplate', 'Golden Scale Coif',
    'Ironforge Gauntlets', 'The Shatterer', 'Ornate Mithril Breastplate',
  ]);
  // Skill: the recipe item's, else the game's minimum, else when it turns yellow.
  assert.equal(byName['Runed Copper Breastplate'].skill, 55);
  assert.equal(byName['The Shatterer'].skill, 235);
  assert.equal(byName['Copper Chain Pants'].skill, 15);
  assert.deepEqual(byName['Copper Chain Pants'].colors, [50, 70, 90]);
  assert.deepEqual(byName['Runed Copper Breastplate'].recipeItems, [2881], 'the plans that teach it, not "Learning"');
  assert.deepEqual(byName['Runed Copper Breastplate'].reagents, [{ id: 2840, count: 12 }, { id: 1210, count: 1 }, { id: 3470, count: 2 }]);
  assert.deepEqual(byName['Copper Chain Pants'].creates, { id: 2852, min: 1, max: 1 });
  assert.equal(byName['Rough Sharpening Stone'].acquire, 1);
  assert.equal(byName['Rough Sharpening Stone'].acquireSkill, 15);

  const items = Object.fromEntries(blacksmithing.items.map((i) => [i.id, i]));
  assert.deepEqual(items[7935], {
    id: 7935, name: 'Ornate Mithril Breastplate', quality: 2, level: 43, slot: 5, icon: 132745,
    kind: 'Chest (Plate)', stats: 'Critical Strike Rating, Dodge Rating', skill: 0, classID: 4, subclassID: 4,
  });
  assert.equal(items[2881].skill, 55);
  // Made, but no row in ItemSparse: named after its recipe; its slot and type from Item.
  assert.equal(items[99002].name, 'Ironforge Gauntlets');
  assert.equal(items[99002].kind, 'Hands (Plate)');

  const enchanting = database.professions[1];
  const enchant = enchanting.recipes.find((r) => r.id === 7418);
  assert.equal(enchant.creates, null);
  assert.equal(enchant.acquire, 2);
  // A reagent with no row in ItemSparse: no name (the game names it in play).
  assert.equal(enchanting.items.find((i) => i.id === 11083).name, '');
  assert.match(database.warnings.join('\n'), /2 items have no row/);
});

test('writes lines the addon reads, with nothing in a field that would break them', () => {
  assert.equal(
    recipeLine({ id: 1, name: 'A\tB;C', skill: 5, colors: [6, 7, 8], creates: null, reagents: [{ id: 2, count: 3 }],
      acquire: 0, acquireSkill: 1, recipeItems: [9] }),
    '1\tA B C\t5\t6,7,8\t\t2:3\t0\t1\t9',
  );
  assert.equal(
    itemLine({ id: 9, name: 'Plans: X', quality: 2, level: 0, slot: 0, icon: 134942, kind: 'Blacksmithing', stats: '',
      skill: 55, classID: 9, subclassID: 4 }),
    '9\tPlans: X\t2\t\t\t134942\tBlacksmithing\t\t55\t9\t4',
  );
  assert.equal(longString('a'), '[[\na]]');
  assert.equal(longString('a]]b]=]'), '[==[\na]]b]=]]==]');
});

test("lists each profession's recipe ids for GuildAssistant Professions, in order, a line every 20", () => {
  const database = {
    version: 'forever', build: '1.2.3',
    professions: [{ name: 'Mining', recipes: Array.from({ length: 22 }, (_, i) => ({ id: 100 - i })) }],
  };
  const lua = toRecipesLua(database);
  assert.match(lua, /^-- GuildAssistant Professions: .*\(forever 1\.2\.3\)\./);
  assert.match(lua, /ns\.Recipes = \{\n    version = "forever",\n    build = "1\.2\.3",/);
  const ids = Array.from({ length: 22 }, (_, i) => 79 + i);
  assert.ok(lua.includes(`["Mining"] = [[\n${ids.slice(0, 20).join(',')},\n${ids.slice(20).join(',')}]],`), lua);
});

test('Recipes.fixture.lua is what the fixture tables build (UPDATE_FIXTURES=1 rewrites it)', () => {
  const lua = toRecipesLua(buildDatabase(tables, meta));
  if (process.env.UPDATE_FIXTURES) writeFileSync(RECIPES_FIXTURE_LUA, lua);
  assert.equal(readFileSync(RECIPES_FIXTURE_LUA, 'utf8'), lua);
});

test('Data.fixture.lua is what the fixture tables build (UPDATE_FIXTURES=1 rewrites it)', () => {
  const lua = toLua(buildDatabase(tables, meta));
  if (process.env.UPDATE_FIXTURES) writeFileSync(FIXTURE_LUA, lua);
  assert.equal(readFileSync(FIXTURE_LUA, 'utf8'), lua);
});

test("asks wago.tools for the latest build and downloads a build's tables once", async () => {
  const asked = [];
  const fetcher = async (url) => {
    asked.push(url);
    if (url.endsWith('/api/builds/latest')) {
      return { ok: true, json: async () => ({ wowf: { version: '1.60.1.70888' } }) };
    }
    const table = url.match(/db2\/(\w+)\/csv/)[1];
    return { ok: true, text: async () => tables[table] ?? 'ID\n' };
  };
  assert.equal(await latestBuild('wowf', fetcher), '1.60.1.70888');
  await assert.rejects(latestBuild('nope', fetcher), /no build of nope/);

  const cache = mkdtempSync(join(tmpdir(), 'gadb-'));
  try {
    const first = await fetchTables('wowf', '1.60.1.70888', cache, fetcher);
    assert.equal(first.SpellName, tables.SpellName);
    assert.equal(asked.filter((url) => url.includes('/db2/')).length, TABLES.length);
    assert.ok(asked.includes('https://wago.tools/db2/SpellName/csv?product=wowf&build=1.60.1.70888'));
    await fetchTables('wowf', '1.60.1.70888', cache, fetcher);
    assert.equal(asked.filter((url) => url.includes('/db2/')).length, TABLES.length, 'kept: not downloaded again');
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
  const failing = async () => ({ ok: false, status: 503 });
  await assert.rejects(latestBuild('wowf', failing), /HTTP 503/);
});

test("writes what players found as a source that only adds, leaving out what isn't one", () => {
  const published = {
    items: [
      { id: 6047, entries: [{ entry: 'V:Tanaris=Krinkle Goodsteel', reporters: 2 }, { entry: 'V:Booty Bay=Narkk', reporters: 1 }] },
      { id: 2881, entries: [{ entry: 'D:Westfall=Defias Renegade Mage' }, { entry: 'not one' }] },
      { id: -1, entries: [{ entry: 'V=Nobody' }] },
    ],
    trainers: [
      { recipe: 'item:2852', cost: 50, entries: [{ entry: 'Stormwind City=Grimand Elmore' }] },
      { recipe: 'spell:1', cost: 5, entries: [{ entry: 'Zone=Trainer' }] },
    ],
  };
  const lua = toFoundLua(published, '2026-11-18');
  assert.match(lua, /name = "found by players",/);
  assert.doesNotMatch(lua, /complete/, 'it hides nothing');
  assert.match(lua, /recipes = \[\[\nitem:2852\t6\t50\tStormwind City=Grimand Elmore\]\],/);
  assert.match(lua, /items = \[\[\n2881\t\t\t\tD:Westfall=Defias Renegade Mage\n6047\t\t\t\tV:Booty Bay=Narkk;V:Tanaris=Krinkle Goodsteel\]\],/);
  assert.equal(toFoundLua({ items: [], trainers: [] }, '2026-11-18'), null, 'nothing found');
  assert.equal(toFoundLua(undefined, '2026-11-18'), null);
  assert.doesNotMatch(EMPTY_FOUND, /table\.insert/, 'an empty one adds no source');
});

test('fetches what players found from Guild Assistant', async () => {
  const asked = [];
  const published = await fetchFound('https://example.test', async (url) => {
    asked.push(url);
    return { ok: true, json: async () => ({ items: [], trainers: [] }) };
  });
  assert.deepEqual(published, { items: [], trainers: [] });
  assert.deepEqual(asked, ['https://example.test/api/recipe-sources']);
  await assert.rejects(fetchFound('https://example.test', async () => ({ ok: false, status: 404 })), /HTTP 404/);
});
