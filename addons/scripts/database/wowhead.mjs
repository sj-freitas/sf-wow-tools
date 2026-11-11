// Turns the pages saved from Wowhead (the snapshot the browser snippet downloads, snippet.mjs)
// into the recipe database: for each profession its recipes (reagents, skill, how they're learned)
// and the items they use and make (name, quality, level, slot, stats). No Node APIs, so it runs
// in a browser too.
//
// What a profession's pages hold, in their scripts:
//   - its spells page: `var listviewspells = [...]`, one entry per spell of the profession (crafts,
//     and its ranks and specializations, which have no reagents and are left out), and
//     `WH.Gatherer.addData(3, …, {...})`, the items they make and use;
//   - its recipe items page: `var listviewitems = [...]`, the plans/patterns/formulas that teach
//     them, with where each one comes from (`source`, `sourcemore`).
import { parseLiteral } from './literal.mjs';
import { PROFESSIONS } from './professions.mjs';

/** The array assigned to `var <name> = ` in one of the scripts, or null. */
export function listview(scripts, name) {
  const marker = `var ${name} = `;
  for (const script of scripts) {
    const at = script.indexOf(marker);
    if (at >= 0) return parseLiteral(script, at + marker.length).value;
  }
  return null;
}

/** What the scripts give WH.Gatherer: { [type]: { [id]: data } } (3 items, 6 spells). */
export function gatherer(scripts) {
  const out = {};
  const call = /WH\.Gatherer\.addData\(\s*(\d+)\s*,\s*\d+\s*,\s*/g;
  for (const script of scripts) {
    for (const match of script.matchAll(call)) {
      const { value } = parseLiteral(script, match.index + match[0].length);
      out[match[1]] = Object.assign(out[match[1]] ?? {}, value);
    }
  }
  return out;
}

// The game's inventory types (INVTYPE_*), as the tooltip names them.
const SLOTS = {
  1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet',
  9: 'Wrist', 10: 'Hands', 11: 'Finger', 12: 'Trinket', 13: 'One-Hand', 14: 'Shield', 15: 'Ranged',
  16: 'Back', 17: 'Two-Hand', 18: 'Bag', 19: 'Tabard', 20: 'Chest', 21: 'Main Hand', 22: 'Off Hand',
  23: 'Held In Off-hand', 24: 'Projectile', 25: 'Thrown', 26: 'Ranged', 27: 'Quiver', 28: 'Relic',
};

// Wowhead's names for an item's stats (its `jsonequip`), in the order a tooltip lists them.
const STATS = [
  ['str', 'Strength'], ['agi', 'Agility'], ['sta', 'Stamina'], ['int', 'Intellect'], ['spi', 'Spirit'],
  ['health', 'Health'], ['mana', 'Mana'], ['healthrgn', 'Health every 5 sec.'], ['manargn', 'Mana every 5 sec.'],
  ['atkpwr', 'Attack Power'], ['rgdatkpwr', 'Ranged Attack Power'], ['feratkpwr', 'Feral Attack Power'],
  ['splpwr', 'Spell Power'], ['spldmg', 'Spell Damage'], ['splheal', 'Healing'],
  ['arcsplpwr', 'Arcane Spell Power'], ['firsplpwr', 'Fire Spell Power'], ['frosplpwr', 'Frost Spell Power'],
  ['holsplpwr', 'Holy Spell Power'], ['natsplpwr', 'Nature Spell Power'], ['shasplpwr', 'Shadow Spell Power'],
  ['critstrkrtng', 'Critical Strike Rating'], ['hitrtng', 'Hit Rating'], ['hastertng', 'Haste Rating'],
  ['splcritstrkrtng', 'Spell Critical Strike Rating'], ['splhitrtng', 'Spell Hit Rating'],
  ['mlecritstrkpct', 'Melee Critical Strike', '%'], ['rgdcritstrkpct', 'Ranged Critical Strike', '%'],
  ['splcritstrkpct', 'Spell Critical Strike', '%'], ['mlehitpct', 'Melee Hit', '%'],
  ['rgdhitpct', 'Ranged Hit', '%'], ['splhitpct', 'Spell Hit', '%'],
  ['defrtng', 'Defense Rating'], ['dodgertng', 'Dodge Rating'], ['parryrtng', 'Parry Rating'],
  ['blockrtng', 'Block Rating'], ['blockamount', 'Block'], ['resirtng', 'Resilience Rating'],
  ['exprtng', 'Expertise Rating'],
  ['arcres', 'Arcane Resistance'], ['firres', 'Fire Resistance'], ['frores', 'Frost Resistance'],
  ['holres', 'Holy Resistance'], ['natres', 'Nature Resistance'], ['shares', 'Shadow Resistance'],
];

const round = (n, digits) => Number(n.toFixed(digits)).toString();

/** "Chest, 463 Armor, +14 Critical Strike Rating": slot, damage and stats, what a search reads. */
export function itemSummary(equip = {}) {
  const parts = [];
  if (SLOTS[equip.slotbak]) parts.push(SLOTS[equip.slotbak]);
  if (equip.nslots) parts.push(`${equip.nslots} Slot`);
  if (equip.dmgmin1 && equip.dmgmax1) parts.push(`${equip.dmgmin1} - ${equip.dmgmax1} Damage`);
  if (equip.speed) parts.push(`Speed ${Number(equip.speed).toFixed(2)}`);
  if (equip.dps) parts.push(`${round(equip.dps, 1)} DPS`);
  if (equip.armor) parts.push(`${equip.armor} Armor`);
  for (const [key, label, unit = ''] of STATS) {
    const value = equip[key];
    if (typeof value === 'number' && value !== 0) {
      parts.push(`${value > 0 ? '+' : ''}${round(value, 2)}${unit} ${label}`);
    }
  }
  return parts.join(', ');
}

// Where a recipe item comes from: Wowhead's `sourcemore` entries, by their type (`t`: 1 a
// creature, 2 an object, 5 a quest). A creature is a drop when it has a dungeon difficulty (`dd`),
// else a vendor if the item is sold at all.
function itemSources(item) {
  const sources = [];
  const sold = (item.source ?? []).includes(5);
  for (const more of item.sourcemore ?? []) {
    if (!more.n) continue;
    let kind;
    if (more.t === 1) kind = more.dd !== undefined || !sold ? 'drop' : 'vendor';
    else if (more.t === 2) kind = 'object';
    else if (more.t === 5) kind = 'quest';
    else continue;
    sources.push({ kind, name: more.n, zone: more.z > 0 ? more.z : 0 });
  }
  return sources;
}

/**
 * A recipe's name as compared with what its recipe item says: lowercase, without punctuation,
 * possessives or plurals, since the two are often written a little differently ("Transmute: Arcanite"
 * and "Recipe: Transmute Arcanite", "Elixir of Ogre Strength" and "…Ogre's Strength").
 */
export const nameKey = (name) =>
  name
    .toLowerCase()
    .replace(/'s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 ? word.replace(/s$/, '') : word))
    .join(' ');

/** "Plans: Runed Copper Breastplate" -> "runed copper breastplate": the recipe a recipe item teaches. */
export const taughtName = (itemName) => nameKey(itemName.replace(/^[^:]+:\s*/, ''));

const NO_LEVEL = 9999; // Wowhead's skill for spells that aren't learned (ranks, specializations)

/**
 * One profession from its pages: { name, skill, recipes, items, warnings }. Recipes are the
 * profession's spells that use reagents; items every item they use or make, and their recipe items.
 */
export function buildProfession(profession, spellScripts, recipeScripts = []) {
  const warnings = [];
  const spells = listview(spellScripts, 'listviewspells') ?? [];
  const known = gatherer([...spellScripts, ...recipeScripts]);
  const gatheredItems = known[3] ?? {};

  const crafts = spells.filter(
    (spell) =>
      Array.isArray(spell.reagents) &&
      spell.reagents.length > 0 &&
      (spell.skill ?? []).includes(profession.skill) &&
      (spell.learnedat ?? 0) < NO_LEVEL,
  );
  if (spells.length > 0 && crafts.length === 0) {
    warnings.push(`${profession.name}: the spells page has no recipes of skill ${profession.skill} (not this profession's page?)`);
  }

  // Recipe items, matched to the recipe they teach by name.
  const byName = new Map();
  for (const spell of crafts) {
    const key = nameKey(spell.name);
    byName.set(key, [...(byName.get(key) ?? []), spell]);
  }
  // The recipes an item teaches: those of its name, else the one recipe whose name starts with it
  // ("Recipe: Greater Dreamless Sleep" teaches "Greater Dreamless Sleep Potion").
  const taughtBy = (item) => {
    const key = taughtName(item.name ?? '');
    if (!key) return null;
    if (byName.has(key)) return byName.get(key);
    const longer = [...byName.keys()].filter((name) => name.startsWith(`${key} `));
    return longer.length === 1 ? byName.get(longer[0]) : null;
  };
  const recipeItemsOf = new Map();
  const recipeItems = new Map();
  for (const item of listview(recipeScripts, 'listviewitems') ?? []) {
    const taught = taughtBy(item);
    if (!taught) {
      warnings.push(`${profession.name}: no recipe for ${item.name} (${item.id})`);
      continue;
    }
    recipeItems.set(item.id, item);
    for (const spell of taught) recipeItemsOf.set(spell.id, [...(recipeItemsOf.get(spell.id) ?? []), item.id]);
  }

  const items = new Map();
  const useItem = (id) => {
    if (items.has(id)) return;
    const data = gatheredItems[id];
    const listed = recipeItems.get(id);
    if (!data && !listed) {
      warnings.push(`${profession.name}: no data for item ${id}`);
      return;
    }
    const equip = data?.jsonequip ?? {};
    items.set(id, {
      id,
      name: (data?.name_enus ?? listed?.name ?? `Item ${id}`).trim(),
      quality: data?.quality ?? listed?.quality ?? 1,
      icon: data?.icon ?? '',
      level: equip.reqlevel ?? 0,
      slot: equip.slotbak ?? 0,
      summary: itemSummary(equip),
      skill: listed?.skill ?? 0,
      sources: listed ? itemSources(listed) : [],
    });
  };

  const recipes = crafts.map((spell) => {
    const taughtBy = recipeItemsOf.get(spell.id) ?? [];
    // Taught by a trainer: Wowhead says so (source 6), or at least gives the trainer's cost.
    const trainer = (spell.source ?? []).includes(6) || (spell.trainingcost ?? 0) > 0;
    // A recipe item's skill is the one that counts when it's the way to learn it (WoW Forever
    // lowered some, and Wowhead's spell still says the old one).
    const itemSkills = taughtBy.map((id) => recipeItems.get(id).skill).filter((n) => n > 0);
    const skill = !trainer && itemSkills.length > 0 ? Math.min(...itemSkills) : spell.learnedat ?? 0;
    const [, yellow = 0, green = 0, grey = 0] = spell.colors ?? [];
    const creates = Array.isArray(spell.creates) && spell.creates[0] > 0
      ? { id: spell.creates[0], min: spell.creates[1] ?? 1, max: spell.creates[2] ?? spell.creates[1] ?? 1 }
      : null;
    if (creates) useItem(creates.id);
    const reagents = spell.reagents.map(([id, count]) => ({ id, count }));
    for (const reagent of reagents) useItem(reagent.id);
    for (const id of taughtBy) useItem(id);
    return {
      id: spell.id,
      name: spell.name.trim(),
      skill,
      colors: [yellow, green, grey],
      creates,
      reagents,
      sources: [...new Set([...(spell.source ?? []), ...(trainer ? [6] : [])])].sort((a, b) => a - b),
      trainingCost: spell.trainingcost ?? 0,
      recipeItems: taughtBy,
    };
  });
  recipes.sort((a, b) => a.skill - b.skill || a.name.localeCompare(b.name) || a.id - b.id);

  return {
    name: profession.name,
    skill: profession.skill,
    recipes,
    items: [...items.values()].sort((a, b) => a.id - b.id),
    warnings,
  };
}

/** The database from a snapshot: { version, fetched, professions, warnings }. */
export function buildDatabase(snapshot, professions = PROFESSIONS) {
  const warnings = [];
  const built = [];
  for (const profession of professions) {
    const pages = (kind) =>
      (snapshot.pages ?? [])
        .filter((page) => page.profession === profession.name && page.kind === kind)
        .flatMap((page) => page.scripts ?? []);
    const spellScripts = pages('spells');
    if (spellScripts.length === 0) {
      warnings.push(`${profession.name}: not in the snapshot`);
      continue;
    }
    const result = buildProfession(profession, spellScripts, pages('recipes'));
    warnings.push(...result.warnings);
    if (result.recipes.length > 0) built.push(result);
  }
  return {
    version: snapshot.version,
    fetched: (snapshot.fetched ?? '').slice(0, 10),
    professions: built,
    warnings,
  };
}
