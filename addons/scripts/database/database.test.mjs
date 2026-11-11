// Tests of the database job (node:test; `npm test` runs them with the Lua specs). The snapshot
// fixture is dev/GuildAssistantDatabase/wowhead.fixture.mjs; Data.fixture.lua next to it is what
// it builds, which the addon's specs load. UPDATE_FIXTURES=1 rewrites it.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { snapshot } from '../../dev/GuildAssistantDatabase/wowhead.fixture.mjs';
import { root } from '../addons.mjs';
import { parseLiteral } from './literal.mjs';
import { itemLine, longString, recipeLine, toLua } from './lua.mjs';
import { PROFESSIONS } from './professions.mjs';
import { snippet } from './snippet.mjs';
import { buildDatabase, buildProfession, gatherer, itemSummary, listview, nameKey, taughtName } from './wowhead.mjs';

const FIXTURE_LUA = join(root, 'dev', 'GuildAssistantDatabase', 'Data.fixture.lua');
const blacksmithing = PROFESSIONS.find((p) => p.name === 'Blacksmithing');
const scriptsOf = (profession, kind) =>
  snapshot.pages.filter((p) => p.profession === profession && p.kind === kind).flatMap((p) => p.scripts);

test('reads literals the way Wowhead writes them', () => {
  const text = `[{"a":1,b:'two',"c":[1,-2.5,.5,1e3],d:{"e":null,f:true,g:false,h:undefined}},"x\\"y\\u00e9\\n"]; rest`;
  const { value, end } = parseLiteral(text);
  assert.deepEqual(value, [{ a: 1, b: 'two', c: [1, -2.5, 0.5, 1000], d: { e: null, f: true, g: false, h: undefined } }, 'x"yé\n']);
  assert.equal(text.slice(end), '; rest');
  assert.throws(() => parseLiteral('{a: someFunction()}'), /Not a literal/);
  assert.throws(() => parseLiteral('"open'), /Unterminated string/);
});

test('finds the listview and the gatherer data in a page', () => {
  const scripts = scriptsOf('Blacksmithing', 'spells');
  const spells = listview(scripts, 'listviewspells');
  assert.equal(spells.length, 8);
  assert.equal(spells[2].popularity, 650); // an unquoted key
  assert.equal(listview(scripts, 'listviewitems'), null);
  const data = gatherer(scripts);
  assert.equal(data[3][2852].name_enus, 'Copper Chain Pants');
  assert.equal(data[6][2660].name_enus, 'Rough Sharpening Stone');
});

test('sums an item up as a search reads it: slot, damage, armor, stats', () => {
  assert.equal(itemSummary({ slotbak: 5, armor: 463, critstrkrtng: 14, dodgertng: 12, reqlevel: 43 }),
    'Chest, 463 Armor, +14 Critical Strike Rating, +12 Dodge Rating');
  assert.equal(itemSummary({ slotbak: 13, dmgmin1: 53, dmgmax1: 99, speed: 2.4, dps: 31.67 }),
    'One-Hand, 53 - 99 Damage, Speed 2.40, 31.7 DPS');
  assert.equal(itemSummary({ mlecritstrkpct: 1, sta: -5 }), '-5 Stamina, +1% Melee Critical Strike');
  assert.equal(itemSummary({ sellprice: 10 }), '');
  assert.equal(itemSummary(undefined), '');
});

test('matches a recipe item to the recipe it teaches by name, however it is punctuated', () => {
  assert.equal(taughtName('Plans: Runed Copper Breastplate'), 'runed copper breastplate');
  assert.equal(taughtName('Formula: Enchant Bracer - Minor Health'), 'enchant bracer minor health');
  assert.equal(taughtName('Recipe: Transmute Arcanite'), nameKey('Transmute: Arcanite'));
  assert.equal(taughtName("Recipe: Elixir of Ogre's Strength"), nameKey('Elixir of Ogre Strength'));
  assert.equal(taughtName("Pattern: Skulker's Leather Shoulder"), nameKey("Skulker's Leather Shoulders"));
  assert.notEqual(taughtName('Recipe: Elixir of Giants'), nameKey('Elixir of Giant Growth'));
});

test('a recipe item teaches the one recipe whose name starts with its own, never a guess among several', () => {
  const spells = (names) => [`var listviewspells = ${JSON.stringify(names.map((name, i) => ({
    id: i + 1, name, learnedat: 10, skill: [171], reagents: [[1, 1]], creates: [100 + i, 1, 1] })))};`];
  const items = (names) => [`var listviewitems = ${JSON.stringify(names.map((name, i) => ({ id: 900 + i, name, skill: 10 })))};`];
  const alchemy = { name: 'Alchemy', skill: 171 };
  const one = buildProfession(alchemy, spells(['Greater Dreamless Sleep Potion', 'Dreamless Sleep Potion']),
    items(['Recipe: Greater Dreamless Sleep']));
  assert.deepEqual(one.recipes.find((r) => r.id === 1).recipeItems, [900]);
  const two = buildProfession(alchemy, spells(['Elixir of Giant Growth', 'Elixir of Giant Strength']), items(['Recipe: Elixir of Giant']));
  assert.deepEqual(two.recipes.flatMap((r) => r.recipeItems), []);
  assert.equal(two.warnings.filter((w) => w.includes('no recipe for')).length, 1);
});

test('builds a profession: its crafts, their reagents and how each is learned', () => {
  const result = buildProfession(blacksmithing, scriptsOf('Blacksmithing', 'spells'), scriptsOf('Blacksmithing', 'recipes'));
  const byName = Object.fromEntries(result.recipes.map((r) => [r.name, r]));
  // Ranks and specializations have no reagents: not recipes.
  assert.deepEqual(result.recipes.map((r) => r.name), [
    'Copper Chain Pants', 'Rough Sharpening Stone', 'Runed Copper Breastplate', 'Golden Scale Coif',
    'The Shatterer', 'Ornate Mithril Breastplate',
  ]);
  // A recipe item's skill wins when it's how the recipe is learned (Forever lowered this one).
  assert.equal(byName['Runed Copper Breastplate'].skill, 55);
  assert.deepEqual(byName['Runed Copper Breastplate'].recipeItems, [2881]);
  assert.deepEqual(byName['Runed Copper Breastplate'].reagents, [{ id: 2840, count: 12 }, { id: 1210, count: 1 }, { id: 3470, count: 2 }]);
  assert.deepEqual(byName['Runed Copper Breastplate'].colors, [95, 115, 135]);
  assert.deepEqual(byName['Copper Chain Pants'].creates, { id: 2852, min: 1, max: 1 });
  // A trainer's cost alone says it's taught by a trainer.
  assert.deepEqual(byName['The Shatterer'].sources, [6]);
  assert.equal(byName['The Shatterer'].trainingCost, 13500);
  assert.deepEqual(byName['Rough Sharpening Stone'].sources, []);

  const items = Object.fromEntries(result.items.map((i) => [i.id, i]));
  assert.deepEqual(items[7935], {
    id: 7935, name: 'Ornate Mithril Breastplate', quality: 2, icon: 'inv_chest_plate10', level: 43, slot: 5,
    summary: 'Chest, 463 Armor, +14 Critical Strike Rating, +12 Dodge Rating', skill: 0, sources: [],
  });
  assert.equal(items[2840].name, 'Copper Bar');
  assert.deepEqual(items[2881].sources, [{ kind: 'drop', name: 'Defias Renegade Mage', zone: 40 }]);
  assert.deepEqual(items[6047].sources, [{ kind: 'vendor', name: 'Krinkle Goodsteel', zone: 440 }]);
  assert.deepEqual(items[7975].sources, [{ kind: 'quest', name: 'Ornate Mithril Armor', zone: 0 }]);
  assert.equal(items[2881].skill, 55);
  assert.deepEqual(result.warnings, ['Blacksmithing: no recipe for Plans: Something Wowhead Lists Alone (12345)']);
});

test("says when a page isn't the profession's (Wowhead's default list)", () => {
  const mining = { name: 'Mining', skill: 186 };
  const result = buildProfession(mining, scriptsOf('Blacksmithing', 'spells'));
  assert.equal(result.recipes.length, 0);
  assert.match(result.warnings[0], /no recipes of skill 186/);
});

test('builds the database from a snapshot, leaving out professions it lacks', () => {
  const database = buildDatabase(snapshot);
  assert.equal(database.version, 'forever');
  assert.equal(database.fetched, '2026-11-11');
  assert.deepEqual(database.professions.map((p) => p.name), ['Blacksmithing', 'Enchanting']);
  assert.ok(database.warnings.includes('Alchemy: not in the snapshot'));
  const enchant = database.professions[1].recipes.find((r) => r.id === 7418);
  assert.equal(enchant.creates, null);
});

test('writes lines the addon reads, with nothing in a field that would break them', () => {
  assert.equal(
    recipeLine({ id: 1, name: 'A\tB;C', skill: 5, colors: [6, 7, 8], creates: null, reagents: [{ id: 2, count: 3 }],
      sources: [2, 6], trainingCost: 0, recipeItems: [] }),
    '1\tA B C\t5\t6,7,8\t\t2:3\t2;6\t\t',
  );
  assert.equal(
    itemLine({ id: 9, name: 'Plans: X', quality: 2, icon: 'inv_scroll_03', level: 0, slot: 0, summary: '', skill: 55,
      sources: [{ kind: 'drop', name: 'Some; Mob', zone: 40 }, { kind: 'quest', name: 'A = B', zone: 0 }] }),
    '9\tPlans: X\t2\t\t\tinv_scroll_03\t\t55\tD40=Some Mob;Q0=A = B',
  );
  assert.equal(longString('a'), '[[\na]]');
  assert.equal(longString('a]]b]=]'), '[==[\na]]b]=]]==]');
});

test('Data.fixture.lua is what the fixture snapshot builds (UPDATE_FIXTURES=1 rewrites it)', () => {
  const lua = toLua(buildDatabase(snapshot));
  if (process.env.UPDATE_FIXTURES) writeFileSync(FIXTURE_LUA, lua);
  assert.equal(readFileSync(FIXTURE_LUA, 'utf8'), lua);
});

test('the browser snippet reads each page once, keeps its data scripts and downloads them', async () => {
  const fetched = [];
  let downloaded;
  const pageFor = (url) => {
    const page = snapshot.pages.find((p) => p.url === url);
    return page ? `<html><script>var other = 1;</script><script>${page.scripts[0]}</script></html>` : '<html></html>';
  };
  const context = {
    location: { hostname: 'www.wowhead.com', origin: 'https://www.wowhead.com' },
    console: { log() {} },
    setTimeout: (fn) => fn(),
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, status: 200, text: async () => pageFor(url) };
    },
    // Just enough of the browser: the page's scripts, and a link that "downloads" when clicked.
    DOMParser: class {
      parseFromString(html) {
        return { scripts: [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, textContent]) => ({ textContent })) };
      }
    },
    Blob: class {
      constructor(parts) { this.text = parts.join(''); }
    },
    URL: { createObjectURL: (blob) => blob },
    document: {
      body: { appendChild() {} },
      createElement: () => ({ click() { downloaded = { name: this.download, data: this.href.text }; }, remove() {} }),
    },
  };
  context.window = context;
  await vm.runInNewContext(`${snippet({ professions: PROFESSIONS.filter((p) => ['Blacksmithing', 'Enchanting', 'Mining'].includes(p.name)) })}`, context);
  await new Promise((done) => setImmediate(done));

  assert.deepEqual(fetched, [
    'https://www.wowhead.com/forever/spells/professions/blacksmithing',
    'https://www.wowhead.com/forever/items/recipes/blacksmithing',
    'https://www.wowhead.com/forever/spells/professions/enchanting',
    'https://www.wowhead.com/forever/items/recipes/enchanting',
    'https://www.wowhead.com/forever/spells/professions/mining',
  ]);
  assert.equal(downloaded.name, 'wowhead-forever.json');
  const saved = JSON.parse(downloaded.data);
  assert.equal(saved.pages[0].scripts.length, 1); // "var other" isn't data
  assert.deepEqual(
    buildDatabase(saved).professions.map((p) => [p.name, p.recipes.length]),
    buildDatabase(snapshot).professions.map((p) => [p.name, p.recipes.length]),
  );
});

test('the snippet only runs on Wowhead', async () => {
  const context = { location: { hostname: 'example.com' }, console, window: {} };
  await assert.rejects(vm.runInNewContext(snippet(), context), /www\.wowhead\.com/);
});
