// The recipe database from the game's own data tables (its DB2 files), as wago.tools exports them
// for each build of each game version (`wowf` is WoW Forever). Everything here is what the game
// client itself knows: each profession's recipes (SkillLineAbility), their names (SpellName),
// reagents (SpellReagents), the item they make (SpellEffect), the items' name, quality, level,
// slot, type and stats (ItemSparse, Item), and which recipe item teaches which recipe (ItemEffect,
// ItemXItemEffect). Not in it, because the game's servers keep it: where a recipe item drops or is
// sold, trainers and their costs, and stat values (the client works those out from the item's
// level). A sources companion addon can add those (Core.lua, "Sources companions").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.mjs';
import { PROFESSIONS } from './professions.mjs';

export const TABLES = [
  'SkillLineAbility', 'SpellName', 'SpellReagents', 'SpellEffect', 'Item', 'ItemSparse', 'ItemEffect',
  'ItemXItemEffect',
];
const WAGO = 'https://wago.tools';

/** wago.tools' product for each game version's data, and the version's name in the data. */
export const PRODUCTS = { forever: 'wowf' };

/** The latest build of `product` wago.tools has: "1.60.1.70888". */
export async function latestBuild(product, fetcher = fetch) {
  const response = await fetcher(`${WAGO}/api/builds/latest`);
  if (!response.ok) throw new Error(`wago.tools builds: HTTP ${response.status}`);
  const builds = await response.json();
  const version = builds[product]?.version;
  if (!version) throw new Error(`wago.tools has no build of ${product}`);
  return version;
}

/**
 * The tables' CSV text for `build` of `product`, downloaded once into `cacheDir` (a build's tables
 * never change). Returns { [table]: text }.
 */
export async function fetchTables(product, build, cacheDir, fetcher = fetch) {
  const dir = join(cacheDir, `${product}-${build}`);
  mkdirSync(dir, { recursive: true });
  const tables = {};
  for (const table of TABLES) {
    const path = join(dir, `${table}.csv`);
    if (!existsSync(path)) {
      const response = await fetcher(`${WAGO}/db2/${table}/csv?product=${product}&build=${build}`);
      if (!response.ok) throw new Error(`wago.tools ${table}: HTTP ${response.status}`);
      writeFileSync(path, await response.text());
    }
    tables[table] = readFileSync(path, 'utf8');
  }
  return tables;
}

// The game's inventory types, as its tooltips name them.
const SLOTS = {
  1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet',
  9: 'Wrist', 10: 'Hands', 11: 'Finger', 12: 'Trinket', 13: 'One-Hand', 14: 'Off Hand', 15: 'Ranged',
  16: 'Back', 17: 'Two-Hand', 18: 'Bag', 19: 'Tabard', 20: 'Chest', 21: 'Main Hand', 22: 'Off Hand',
  23: 'Held In Off-hand', 24: 'Projectile', 25: 'Thrown', 26: 'Ranged', 27: 'Quiver', 28: 'Relic',
};

// Item classes and subclasses, as the game names them (what a search for "plate" or "maces" finds).
const TYPES = {
  0: { 1: 'Potion', 2: 'Elixir', 3: 'Flask', 4: 'Scroll', 5: 'Food & Drink', 6: 'Item Enhancement', 7: 'Bandage', 8: 'Consumable' },
  1: { 0: 'Bag' },
  2: {
    0: 'One-Handed Axes', 1: 'Two-Handed Axes', 2: 'Bows', 3: 'Guns', 4: 'One-Handed Maces', 5: 'Two-Handed Maces',
    6: 'Polearms', 7: 'One-Handed Swords', 8: 'Two-Handed Swords', 10: 'Staves', 13: 'Fist Weapons', 14: 'Miscellaneous',
    15: 'Daggers', 16: 'Thrown', 18: 'Crossbows', 19: 'Wands', 20: 'Fishing Poles',
  },
  4: { 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 6: 'Shield' },
  6: { 2: 'Arrow', 3: 'Bullet' },
  7: { 0: 'Trade Goods', 1: 'Parts', 2: 'Explosives', 3: 'Devices', 5: 'Cloth', 6: 'Leather', 7: 'Metal & Stone', 8: 'Cooking', 9: 'Herb', 10: 'Elemental', 12: 'Enchanting' },
  9: { 0: 'Book', 1: 'Leatherworking', 2: 'Tailoring', 3: 'Engineering', 4: 'Blacksmithing', 5: 'Cooking', 6: 'Alchemy', 7: 'First Aid', 8: 'Enchanting', 9: 'Fishing' },
};

// The game's stat types (an item says which it has; its level decides how much).
const STATS = {
  0: 'Mana', 1: 'Health', 3: 'Agility', 4: 'Strength', 5: 'Intellect', 6: 'Spirit', 7: 'Stamina',
  12: 'Defense Rating', 13: 'Dodge Rating', 14: 'Parry Rating', 15: 'Block Rating', 16: 'Melee Hit Rating',
  17: 'Ranged Hit Rating', 18: 'Spell Hit Rating', 19: 'Melee Critical Strike Rating', 20: 'Ranged Critical Strike Rating',
  21: 'Spell Critical Strike Rating', 31: 'Hit Rating', 32: 'Critical Strike Rating', 35: 'Resilience Rating',
  36: 'Haste Rating', 37: 'Expertise Rating', 38: 'Attack Power', 39: 'Ranged Attack Power', 40: 'Feral Attack Power',
  41: 'Healing', 42: 'Spell Damage', 43: 'Mana every 5 sec.', 44: 'Armor Penetration Rating', 45: 'Spell Power',
  46: 'Health every 5 sec.', 47: 'Spell Penetration', 48: 'Block Value', 50: 'Bonus Armor',
};

const CREATE_ITEM = '24'; // SpellEffect.Effect
const LEARN_SPELL = '6'; // ItemEffect.TriggerType: the item teaches its SpellID

const num = (value) => Number(value) || 0;

/** "Chest (Plate)", "One-Hand (One-Handed Maces)", "Potion": the item's slot and type. */
export function itemKind(sparse, item) {
  const slot = SLOTS[num(sparse?.InventoryType ?? item?.InventoryType)];
  const type = TYPES[num(item?.ClassID)]?.[num(item?.SubclassID)];
  if (slot && type) return `${slot} (${type})`;
  return slot ?? type ?? '';
}

/** "Speed 2.40, Critical Strike Rating, Dodge Rating": a weapon's speed and the stats it has. */
export function itemStats(sparse, item) {
  const parts = [];
  if (num(item?.ClassID) === 2 && num(sparse?.ItemDelay) > 0) parts.push(`Speed ${(num(sparse.ItemDelay) / 1000).toFixed(2)}`);
  for (let i = 0; i < 10; i++) {
    const name = STATS[sparse?.[`StatModifier_bonusStat_${i}`]];
    if (name && !parts.includes(name)) parts.push(name);
  }
  return parts.join(', ');
}

const byKey = (rows, key) => {
  const map = new Map();
  for (const row of rows) map.set(row[key], row);
  return map;
};

/**
 * The database from the tables' CSV text ({ [table]: text }): { version, build, fetched,
 * professions, warnings }, each profession { name, skill, recipes, items }.
 */
export function buildDatabase(csv, { version, build, fetched }, professions = PROFESSIONS) {
  const table = (name) => parseCsv(csv[name] ?? '');
  const names = byKey(table('SpellName'), 'ID');
  const reagentsOf = byKey(table('SpellReagents'), 'SpellID');
  const sparse = byKey(table('ItemSparse'), 'ID');
  const itemRows = byKey(table('Item'), 'ID');
  const created = new Map();
  for (const effect of table('SpellEffect')) {
    if (effect.Effect === CREATE_ITEM && num(effect.EffectItemType) > 0 && !created.has(effect.SpellID)) {
      created.set(effect.SpellID, { id: num(effect.EffectItemType), count: Math.max(1, Math.round(num(effect.EffectBasePointsF))) });
    }
  }
  // Recipe items: the item whose effect teaches the recipe's spell.
  const effects = byKey(table('ItemEffect'), 'ID');
  const taughtBy = new Map();
  for (const link of table('ItemXItemEffect')) {
    const effect = effects.get(link.ItemEffectID);
    if (effect?.TriggerType === LEARN_SPELL && sparse.has(link.ItemID)) {
      taughtBy.set(effect.SpellID, [...new Set([...(taughtBy.get(effect.SpellID) ?? []), num(link.ItemID)])]);
    }
  }
  const abilities = table('SkillLineAbility');

  const warnings = [];
  const missing = new Set();
  const built = professions.map((profession) => {
    const items = new Map();
    // An item the game's tables have no row for (some are only sent by the servers) has no name
    // here: an item made takes its recipe's, a reagent's is asked of the game in play.
    const useItem = (id, fallbackName = '') => {
      if (items.has(id)) {
        // Seen first as a reagent: the recipe that makes it names it.
        if (!items.get(id).name) items.get(id).name = fallbackName.trim();
        return;
      }
      const row = sparse.get(String(id));
      const item = itemRows.get(String(id));
      if (!row) missing.add(id);
      items.set(id, {
        id,
        name: (row?.Display_lang ?? fallbackName).trim(),
        quality: row ? num(row.OverallQualityID) : 1,
        level: num(row?.RequiredLevel),
        slot: num(row?.InventoryType ?? item?.InventoryType),
        icon: num(item?.IconFileDataID),
        kind: itemKind(row, item),
        stats: itemStats(row, item),
        skill: num(row?.RequiredSkillRank),
        classID: num(item?.ClassID),
        subclassID: num(item?.SubclassID),
      });
    };

    const seen = new Set();
    const recipes = [];
    for (const ability of abilities) {
      const spell = ability.Spell;
      if (num(ability.SkillLine) !== profession.skill || seen.has(spell)) continue;
      const reagentRow = reagentsOf.get(spell);
      const name = names.get(spell)?.Name_lang?.trim();
      if (!reagentRow || !name) continue; // ranks, specializations: no reagents
      seen.add(spell);
      const reagents = [];
      for (let i = 0; i < 8; i++) {
        const id = num(reagentRow[`Reagent_${i}`]);
        const count = num(reagentRow[`ReagentCount_${i}`]);
        if (id > 0 && count > 0) reagents.push({ id, count });
      }
      if (reagents.length === 0) continue;
      const made = created.get(spell);
      const recipeItems = taughtBy.get(spell) ?? [];
      for (const reagent of reagents) useItem(reagent.id);
      if (made) useItem(made.id, name);
      for (const id of recipeItems) useItem(id);
      const acquire = num(ability.AcquireMethod);
      const min = num(ability.MinSkillLineRank);
      const low = num(ability.TrivialSkillLineRankLow);
      const high = num(ability.TrivialSkillLineRankHigh);
      // The skill to learn it: its recipe item's, else the game's minimum, else when it turns yellow.
      const itemSkills = recipeItems.map((id) => items.get(id).skill).filter((n) => n > 0);
      let skill;
      if (itemSkills.length > 0) skill = Math.min(...itemSkills);
      else if (min > 1 || acquire > 0) skill = Math.max(min, 1);
      else skill = Math.max(low, 1);
      recipes.push({
        id: num(spell),
        name,
        skill,
        // Yellow from TrivialLow, grey at TrivialHigh, green halfway.
        colors: [low, Math.floor((low + high) / 2), high],
        creates: made ? { id: made.id, min: made.count, max: made.count } : null,
        reagents,
        acquire,
        acquireSkill: Math.max(min, 1),
        recipeItems,
      });
    }
    recipes.sort((a, b) => a.skill - b.skill || a.name.localeCompare(b.name) || a.id - b.id);
    return { name: profession.name, skill: profession.skill, recipes, items: [...items.values()].sort((a, b) => a.id - b.id) };
  });

  if (missing.size > 0) warnings.push(`${missing.size} items have no row in the game's item tables (named in game instead)`);
  return { version, build, fetched, professions: built.filter((p) => p.recipes.length > 0), warnings };
}
