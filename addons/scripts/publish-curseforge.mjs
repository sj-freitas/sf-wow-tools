// Uploads an addon's package to CurseForge, through its upload API (what the BigWigs packager and
// most WoW release tooling use). Needs, in addons/.env (see .env.example):
//   CURSEFORGE_API_TOKEN   from https://authors.curseforge.com/#/settings/api-tokens
// and in the addon's .toc:
//   ## X-Curse-Project-ID: 123456   (the project, created once by hand on CurseForge)
//
//   npm run publish:curseforge -- Raidsort            upload a release
//   npm run publish:curseforge -- Raidsort --beta     or --alpha
//   npm run publish:curseforge -- Raidsort --dry-run  show what would be uploaded, upload nothing
//
// The game versions it is for come from the .toc's interface numbers (11509 = 1.15.9); one that
// CurseForge doesn't list (yet) is reported and left out. The changelog is the addon's
// CHANGELOG.md section for this version when there is one.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findAddons, interfaceToVersion, packageAddon, root } from './addons.mjs';

const API = 'https://wow.curseforge.com/api';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const names = args.filter((arg) => !arg.startsWith('--'));
if (names.length !== 1) {
  console.error('Usage: npm run publish:curseforge -- <Addon> [--beta|--alpha] [--dry-run]');
  process.exit(1);
}
const dryRun = flags.has('--dry-run');
const releaseType = flags.has('--alpha') ? 'alpha' : flags.has('--beta') ? 'beta' : 'release';

if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const token = process.env.CURSEFORGE_API_TOKEN;
if (!token && !dryRun) {
  console.error('Missing CURSEFORGE_API_TOKEN: put it in addons/.env (see .env.example).');
  process.exit(1);
}

const [addon] = findAddons(names);
const projectId = addon.fields['X-Curse-Project-ID'];
if (!projectId) {
  const problem = `${addon.name}.toc has no "## X-Curse-Project-ID:" (the project's id on CurseForge).`;
  if (!dryRun) {
    console.error(problem);
    process.exit(1);
  }
  console.warn(`${problem} Fine for a dry run.`);
}

/** This version's part of CHANGELOG.md ("## 2.0.0" up to the next "## "), if there is one. */
function changelogFor() {
  const path = join(addon.dir, 'CHANGELOG.md');
  if (!existsSync(path)) return `${addon.name} ${addon.version}`;
  const text = readFileSync(path, 'utf8');
  const start = text.search(new RegExp(`^##\\s*\\[?${addon.version.replace(/\./g, '\\.')}\\b`, 'm'));
  if (start < 0) return `${addon.name} ${addon.version}`;
  const rest = text.slice(start);
  const end = rest.slice(1).search(/^##\s/m);
  return (end < 0 ? rest : rest.slice(0, end + 1)).trim();
}

async function call(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'X-Api-Token': token ?? '', ...init.headers },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`CurseForge ${path}: ${response.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

const wanted = addon.interfaces.map(interfaceToVersion);
let gameVersions = [];
if (token) {
  const known = await call('/game/versions');
  gameVersions = wanted
    .map((name) => ({ name, match: known.find((version) => version.name === name) }))
    .filter(({ name, match }) => match || console.warn(`CurseForge has no game version ${name}: left out.`))
    .map(({ match }) => match.id);
  if (gameVersions.length === 0) {
    console.error(`None of ${wanted.join(', ')} are game versions on CurseForge: nothing to upload for.`);
    process.exit(1);
  }
}

const { path, relativePath, files } = packageAddon(addon);
const metadata = {
  displayName: `${addon.name} ${addon.version}`,
  releaseType,
  changelog: changelogFor(),
  changelogType: 'markdown',
  gameVersions,
};
console.log(`${relativePath} (${files.length} files) -> CurseForge project ${projectId ?? "(none yet)"}`);
console.log(`  ${releaseType}, for ${wanted.join(', ')}`);

if (dryRun) {
  console.log('Dry run: nothing uploaded. Metadata:', JSON.stringify(metadata, null, 2));
} else {
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  form.append('file', new Blob([readFileSync(path)], { type: 'application/zip' }), basename(path));
  const { id } = await call(`/projects/${projectId}/upload-file`, { method: 'POST', body: form });
  console.log(`Uploaded: file ${id}. CurseForge reviews it before it is public.`);
}
