// The database job: builds GuildAssistantDatabase's data from the game's own data tables, as
// wago.tools exports them for the latest build of WoW Forever (Data.lua; and GuildAssistant
// Professions' list of every recipe's id, Recipes.lua, from the same tables), and what players found of
// how recipes are obtained, as Guild Assistant gathered it from their GuildAssistant Professions
// (Found.lua, found.mjs). Plain downloads, no browser needed: the weekly GitHub Action runs it
// (.github/workflows/database.yml) and opens a pull request when either changed.
//
//   npm run database                   the latest build (tables kept in addons/.cache)
//   npm run database -- --build 1.60.1.70888
//   npm run database -- --notes        when anything changed: a patch change note for each addon
//                                      whose files changed (addons/changes/, scripts/release.mjs);
//                                      the upload makes the version
//
// Says what it built per profession, and how much was found. What was known before (trainers,
// drops, vendors, quests) is the seed, Seed.lua: compiled once, not rebuilt here.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root } from '../addons.mjs';
import { notesDir } from '../release.mjs';
import { EMPTY_FOUND, fetchFound, GUILD_ASSISTANT, toFoundLua } from './found.mjs';
import { buildDatabase, fetchTables, latestBuild, PRODUCTS } from './gamedata.mjs';
import { toLua, toRecipesLua } from './lua.mjs';
import { DEFAULT_VERSION } from './professions.mjs';

const ADDON = join(root, 'GuildAssistantDatabase');
const DATA = join(ADDON, 'Data.lua');
const FOUND = join(ADDON, 'Found.lua');
const PROFESSIONS_ADDON = join(root, 'GuildAssistantProfessions');
const RECIPES = join(PROFESSIONS_ADDON, 'Recipes.lua');
const args = process.argv.slice(2);
if (args.includes('--bump')) {
  console.error('--bump is now --notes: the version is made when the addon is uploaded (scripts/release.mjs).');
  process.exit(1);
}
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const today = new Date().toISOString().slice(0, 10);

/** Writes `text` to `path` unless only the date it was fetched differs. Returns whether it did. */
function update(path, text) {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const withoutDate = (lua) => lua.replace(/fetched[ =]+[^\n]*\n/g, '');
  if (withoutDate(before) === withoutDate(text)) return false;
  writeFileSync(path, text);
  return true;
}

const version = DEFAULT_VERSION;
const product = PRODUCTS[version];
const build = option('--build') ?? (await latestBuild(product));
const tables = await fetchTables(product, build, join(root, '.cache', 'wago'));
const database = buildDatabase(tables, { version, build, fetched: today });
if (database.professions.length === 0) {
  console.error(`No recipes in ${product} ${build}'s tables.`);
  process.exit(1);
}
const dataChanged = update(DATA, toLua(database));
console.log(`From the game's tables (${product} ${build}):`);
for (const profession of database.professions) {
  const taught = profession.recipes.filter((r) => r.recipeItems.length > 0).length;
  console.log(`  ${profession.name}: ${profession.recipes.length} recipes (${taught} taught by a recipe item), ${profession.items.length} items`);
}
for (const warning of database.warnings) console.log(`  ${warning}`);
console.log(dataChanged ? `Wrote ${relative(root, DATA)} (${Math.round(statSync(DATA).size / 1024)} KB).` : `${relative(root, DATA)} is up to date.`);
const recipesChanged = update(RECIPES, toRecipesLua(database));
console.log(recipesChanged ? `Wrote ${relative(root, RECIPES)} (${Math.round(statSync(RECIPES).size / 1024)} KB).` : `${relative(root, RECIPES)} is up to date.`);

// What players found. Guild Assistant out of reach: Found.lua stays as it is.
let foundChanged = false;
try {
  const published = await fetchFound();
  const lua = toFoundLua(published, today) ?? EMPTY_FOUND;
  foundChanged = update(FOUND, lua);
  const places = (published.items ?? []).reduce((n, item) => n + (item.entries?.length ?? 0), 0);
  console.log(`Found by players (${GUILD_ASSISTANT}): ${published.items?.length ?? 0} recipe items in ${places} places, ${published.trainers?.length ?? 0} trainer recipes.`);
  console.log(foundChanged ? `Wrote ${relative(root, FOUND)}.` : `${relative(root, FOUND)} is up to date.`);
} catch (error) {
  if (!existsSync(FOUND)) writeFileSync(FOUND, EMPTY_FOUND);
  console.log(`Found by players: not fetched (${error.message}); ${relative(root, FOUND)} left as it is.`);
}

/**
 * A patch change note for the addon (scripts/release.mjs): its upload picks the version. Each kind of
 * update has its own file, rewritten by the next run, so a week's note replaces the last one's
 * rather than piling up while nothing is uploaded.
 */
function note(name, file, line) {
  const dir = notesDir(name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `---\nbump: patch\n---\n\n${line}\n`);
  console.log(`Change note: ${relative(root, join(dir, file))}.`);
}

if (args.includes('--notes')) {
  if (dataChanged) note('GuildAssistantDatabase', 'recipe-data.md', `- Recipe data from the game's build ${build}.`);
  if (foundChanged) note('GuildAssistantDatabase', 'what-players-found.md', '- What players found of how recipes are obtained, up to date.');
  if (recipesChanged) note('GuildAssistantProfessions', 'recipe-list.md', `- The recipes it checks at login, from the game's build ${build}.`);
}
