// The database job: builds GuildAssistantDatabase's data (GuildAssistantDatabase/Data.lua) from
// Wowhead's profession pages, as saved by the browser snippet (snippet.mjs).
//
//   npm run database                         the newest ~/Downloads/wowhead-forever*.json
//   npm run database -- path/to/file.json    that file
//   npm run database -- --verbose            and list each recipe item left out
//
// Says what it built per profession, and what didn't match: recipe items whose recipe Wowhead
// doesn't list for the version (unused ones, cookbooks, sets not out yet), counted per profession,
// and anything else.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { root } from '../addons.mjs';
import { toLua } from './lua.mjs';
import { DEFAULT_VERSION } from './professions.mjs';
import { buildDatabase } from './wowhead.mjs';

const OUTPUT = join(root, 'GuildAssistantDatabase', 'Data.lua');

/** The most recent download of the snippet's file (browsers add " (1)" to a second one). */
function newestDownload(version) {
  const folder = join(homedir(), 'Downloads');
  if (!existsSync(folder)) return null;
  const pattern = new RegExp(`^wowhead-${version}( \\(\\d+\\))?\\.json$`);
  const files = readdirSync(folder)
    .filter((name) => pattern.test(name))
    .map((name) => join(folder, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const input = args.find((arg) => !arg.startsWith('--')) ?? newestDownload(DEFAULT_VERSION);
if (!input || !existsSync(input)) {
  console.error(
    `No snapshot of Wowhead's pages${input ? ` at ${input}` : ` (~/Downloads/wowhead-${DEFAULT_VERSION}.json)`}.\n` +
      'Get one: npm run -s database:snippet | pbcopy, then paste it in the console of a www.wowhead.com page.',
  );
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(input, 'utf8'));
const database = buildDatabase(snapshot);
if (database.professions.length === 0) {
  console.error(`${input}: no recipes in it.`);
  process.exit(1);
}
writeFileSync(OUTPUT, toLua(database));

console.log(`From ${input} (Wowhead ${database.version}, ${database.fetched}):`);
for (const profession of database.professions) {
  const taught = profession.recipes.filter((r) => r.recipeItems.length > 0).length;
  console.log(
    `  ${profession.name}: ${profession.recipes.length} recipes (${taught} from recipe items), ${profession.items.length} items`,
  );
}
const leftOut = database.warnings.filter((warning) => warning.includes(': no recipe for '));
const others = database.warnings.filter((warning) => !leftOut.includes(warning));
if (leftOut.length > 0) {
  const counts = new Map();
  for (const warning of leftOut) {
    const profession = warning.split(':')[0];
    counts.set(profession, (counts.get(profession) ?? 0) + 1);
  }
  const perProfession = [...counts].map(([name, count]) => `${name} ${count}`).join(', ');
  console.log(`Recipe items left out, their recipe isn't on Wowhead's list: ${perProfession}${verbose ? '' : ' (--verbose lists them)'}`);
  if (verbose) for (const warning of leftOut) console.log(`  ${warning}`);
}
if (others.length > 0) {
  console.log(`${others.length} warnings:`);
  for (const warning of others) console.log(`  ${warning}`);
}
console.log(`Wrote ${relative(root, OUTPUT)} (${Math.round(statSync(OUTPUT).size / 1024)} KB).`);
