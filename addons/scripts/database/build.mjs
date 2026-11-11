// The database job: builds GuildAssistantDatabase's data (GuildAssistantDatabase/Data.lua) from the
// game's own data tables, as wago.tools exports them for the latest build of WoW Forever. Plain
// downloads, no browser needed: the weekly GitHub Action runs it (.github/workflows/database.yml).
//
//   npm run database                   the latest build (tables kept in addons/.cache)
//   npm run database -- --build 1.60.1.70888
//   npm run database -- --bump         when Data.lua changed: a patch version and a CHANGELOG line
//
// Says what it built per profession. Where recipes come from (drops, vendors, trainers) isn't in
// the game's tables: a sources companion addon can add it (Core.lua, "Sources companions").
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root } from '../addons.mjs';
import { buildDatabase, fetchTables, latestBuild, PRODUCTS } from './gamedata.mjs';
import { toLua } from './lua.mjs';
import { DEFAULT_VERSION } from './professions.mjs';

const ADDON = join(root, 'GuildAssistantDatabase');
const OUTPUT = join(ADDON, 'Data.lua');
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const version = DEFAULT_VERSION;
const product = PRODUCTS[version];
const build = option('--build') ?? (await latestBuild(product));
const tables = await fetchTables(product, build, join(root, '.cache', 'wago'));
const database = buildDatabase(tables, { version, build, fetched: new Date().toISOString().slice(0, 10) });
if (database.professions.length === 0) {
  console.error(`No recipes in ${product} ${build}'s tables.`);
  process.exit(1);
}

// The same data as before (only the date it was fetched differs): Data.lua is left as it is.
const before = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
const withoutDate = (lua) => lua.replace(/fetched[ =]+[^\n]*\n/g, '');
const lua = toLua(database);
const changed = withoutDate(before) !== withoutDate(lua);
if (changed) writeFileSync(OUTPUT, lua);

console.log(`From the game's tables (${product} ${build}):`);
for (const profession of database.professions) {
  const taught = profession.recipes.filter((r) => r.recipeItems.length > 0).length;
  console.log(`  ${profession.name}: ${profession.recipes.length} recipes (${taught} taught by a recipe item), ${profession.items.length} items`);
}
for (const warning of database.warnings) console.log(`  ${warning}`);
if (!changed) {
  console.log(`${relative(root, OUTPUT)} is up to date.`);
  process.exit(0);
}
console.log(`Wrote ${relative(root, OUTPUT)} (${Math.round(statSync(OUTPUT).size / 1024)} KB).`);

if (args.includes('--bump')) {
  // A new patch version, with a CHANGELOG line saying which build the data is from.
  const tocPath = join(ADDON, 'GuildAssistantDatabase.toc');
  const toc = readFileSync(tocPath, 'utf8');
  const [, major, minor, patch] = toc.match(/^## Version: (\d+)\.(\d+)\.(\d+)/m);
  const next = `${major}.${minor}.${Number(patch) + 1}`;
  writeFileSync(tocPath, toc.replace(/^## Version: .*$/m, `## Version: ${next}`));
  const changelogPath = join(ADDON, 'CHANGELOG.md');
  const changelog = readFileSync(changelogPath, 'utf8');
  writeFileSync(
    changelogPath,
    changelog.replace(/^(# .*\n\n)/, `$1## ${next}\n\n- Recipe data from the game's build ${build}.\n\n`),
  );
  console.log(`Version ${next}.`);
}
