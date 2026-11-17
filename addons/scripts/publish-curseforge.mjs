// Releases an addon on CurseForge, through its upload API (what the BigWigs packager and most WoW
// release tooling use). Needs, in addons/.env (see .env.example):
//   CURSEFORGE_API_TOKEN   from https://authors.curseforge.com/#/settings/api-tokens
// and in the addon's .toc:
//   ## X-Curse-Project-ID: 123456   (the project, created once by hand on CurseForge)
//
//   npm run publish:curseforge -- Raidsort            release it
//   npm run publish:curseforge -- Raidsort --beta     or --alpha
//   npm run publish:curseforge -- Raidsort --dry-run  say what it would release and pack it; nothing
//                                                     uploaded or written
//
// The version is decided here, from the addon's change notes (addons/changes/<Name>/*.md;
// release.mjs explains them): the last upload's version (the .toc's, written by each upload), bumped
// by the biggest note, the notes' lines being its CHANGELOG section and its release notes. Without
// notes there's nothing to upload, but for a beta or alpha becoming a release of the same version.
// It also asks CurseForge which versions it has, and never uploads one of them again, nor from a
// .toc behind them. Asking needs no token (its site's API); when it can't be reached, an upload
// stops, unless --no-check.
//
// An upload runs from main, up to date with origin and with the addon's files committed. Once
// uploaded, it writes the version into the .toc and the section into CHANGELOG.md, deletes the
// notes, commits that and pushes it, so the next change, wherever it's made, starts from it.
//
// The game versions it is for come from the .toc's interface numbers (11509 = 1.15.9); one that
// CurseForge doesn't list (yet) is reported and left out.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findAddons, interfaceToVersion, packageAddon, root } from './addons.mjs';
import {
  clashes,
  compareVersions,
  filesFromCurseForge,
  newestVersion,
  planRelease,
  promotes,
  readNotes,
  tocWithVersion,
} from './release.mjs';

const API = 'https://wow.curseforge.com/api';
const SITE_API = 'https://www.curseforge.com/api/v1';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const names = args.filter((arg) => !arg.startsWith('--'));
if (names.length !== 1) {
  console.error('Usage: npm run publish:curseforge -- <Addon> [--beta|--alpha] [--dry-run] [--no-check]');
  process.exit(1);
}
const dryRun = flags.has('--dry-run');
const unchecked = flags.has('--no-check');
const releaseType = flags.has('--alpha') ? 'alpha' : flags.has('--beta') ? 'beta' : 'release';
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const token = process.env.CURSEFORGE_API_TOKEN;
if (!token && !dryRun) fail('Missing CURSEFORGE_API_TOKEN: put it in addons/.env (see .env.example).');

const [addon] = findAddons(names);
const projectId = addon.fields['X-Curse-Project-ID'];
if (!projectId) {
  const problem = `${addon.name}.toc has no "## X-Curse-Project-ID:" (the project's id on CurseForge).`;
  if (!dryRun) fail(problem);
  console.warn(`${problem} Fine for a dry run.`);
}

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();
const tocFile = `${addon.name}.toc`;
const paths = [join(addon.name, tocFile), join(addon.name, 'CHANGELOG.md')];

// An upload releases what's committed on main, as origin has it: another session's release or
// change notes can't be missed, and nobody's work in progress goes out.
if (!dryRun) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') fail(`Upload from main (this is ${branch}).`);
  git('fetch', '--quiet', 'origin', 'main');
  const [ahead, behind] = git('rev-list', '--left-right', '--count', 'HEAD...origin/main').split(/\s+/).map(Number);
  if (behind > 0) fail(`main is ${behind} commit(s) behind origin/main: git pull first.`);
  if (ahead > 0) console.warn(`main is ${ahead} commit(s) ahead of origin/main: they're pushed with the release.`);
  const dirty = git('status', '--porcelain', '--', addon.name, join('changes', addon.name));
  if (dirty) fail(`${addon.name} has changes that aren't committed:\n${dirty}\nCommit them (or set them aside) first.`);
}

/** Every file of the project on CurseForge, from its site's API (no token needed). */
async function curseforgeFiles() {
  const files = [];
  for (let page = 0; ; page++) {
    const response = await fetch(`${SITE_API}/mods/${projectId}/files?pageIndex=${page}&pageSize=50`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const { data, pagination } = await response.json();
    if (!Array.isArray(data)) throw new Error('its answer has no list of files');
    files.push(...data);
    if (data.length === 0 || files.length >= (pagination?.totalCount ?? 0)) break;
  }
  return filesFromCurseForge(files, addon.name);
}

let files = null;
if (projectId) {
  try {
    files = await curseforgeFiles();
  } catch (error) {
    const problem = `Couldn't ask CurseForge which versions it has (${error.message}).`;
    if (!dryRun && !unchecked) fail(`${problem} Nothing uploaded; --no-check uploads without asking.`);
    console.warn(`${problem} Taking ${addon.version} (the .toc's) as the newest there.`);
  }
}

const notes = readNotes(addon.name);
const changelogPath = join(addon.dir, 'CHANGELOG.md');
const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
const released = files ? newestVersion(files) : projectId ? addon.version : null;
let plan;
try {
  plan = planRelease({ released, tocVersion: addon.version, notes, changelog });
} catch (error) {
  fail(`${addon.name}: ${error.message}`);
}

// A file just uploaded can take a while to show in CurseForge's list; the .toc already says it.
const unlisted =
  released && compareVersions(addon.version, released) > 0 ? ` (it doesn't list the .toc's ${addon.version} yet)` : '';
console.log(
  `${addon.name}: ${released ? `${released} on CurseForge${unlisted}` : 'nothing on CurseForge yet'}, ` +
    `${notes.length} change note(s)${notes.length ? ` (${notes.map((note) => note.bump).join(', ')})` : ''} -> ${plan.version}`,
);
const repeated = files ? clashes(files, plan.version, releaseType) : [];
if (repeated.length > 0) {
  const which = repeated.map((file) => `file ${file.id}, ${file.releaseType}`).join('; ');
  fail(
    `${addon.name} ${plan.version} is already on CurseForge (${which}): nothing new to release. ` +
      `A change adds a note in addons/changes/${addon.name}/ (see scripts/release.mjs).`,
  );
}
if (!plan.fresh && released && !promotes(files ?? [], plan.version, releaseType)) {
  fail(
    `${addon.name} has no change notes: nothing new since ${plan.version}, its last upload. ` +
      `A change adds a note in addons/changes/${addon.name}/ (see scripts/release.mjs).`,
  );
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
    fail(`None of ${wanted.join(', ')} are game versions on CurseForge: nothing to upload for.`);
  }
}

const toc = tocWithVersion(readFileSync(join(addon.dir, tocFile), 'utf8'), plan.version);
const { path, relativePath, files: packed } = packageAddon(
  { ...addon, version: plan.version },
  { [tocFile]: toc, ...(plan.changelog ? { 'CHANGELOG.md': plan.changelog } : {}) },
);
const metadata = {
  displayName: `${addon.name} ${plan.version}`,
  releaseType,
  changelog: plan.section ?? `${addon.name} ${plan.version}`,
  changelogType: 'markdown',
  gameVersions,
};
console.log(`${relativePath} (${packed.length} files) -> CurseForge project ${projectId ?? '(none yet)'}`);
console.log(`  ${releaseType}, for ${wanted.join(', ')}`);

if (dryRun) {
  console.log('Dry run: nothing uploaded or written. Metadata:', JSON.stringify(metadata, null, 2));
  process.exit(0);
}

const form = new FormData();
form.append('metadata', JSON.stringify(metadata));
form.append('file', new Blob([readFileSync(path)], { type: 'application/zip' }), basename(path));
const { id } = await call(`/projects/${projectId}/upload-file`, { method: 'POST', body: form });
console.log(`Uploaded: file ${id}. CurseForge reviews it before it is public.`);

// What was released, written down where every session sees it.
if (!plan.fresh) process.exit(0);
writeFileSync(join(addon.dir, tocFile), toc);
if (plan.changelog) writeFileSync(changelogPath, plan.changelog);
for (const note of notes) rmSync(join(root, note.file));
const releasedPaths = [...paths, ...(notes.length ? [join('changes', addon.name)] : [])];
try {
  git('add', '--all', '--', ...releasedPaths);
  git(
    'commit',
    '--quiet',
    '-m',
    `${addon.name} ${plan.version}: uploaded to CurseForge (file ${id}, ${releaseType})`,
    '-m',
    notes.length
      ? `Its change notes went into CHANGELOG.md: ${notes.map((note) => note.file.split('/').pop()).join(', ')}.`
      : 'Its CHANGELOG section was already there.',
    '--',
    ...releasedPaths,
  );
  git('push', '--quiet', 'origin', 'main');
  console.log(`Committed and pushed: ${addon.name} is ${plan.version} on main.`);
} catch (error) {
  console.error(
    `Uploaded, but committing or pushing it failed (${error.message.split('\n')[0]}). ` +
      `Commit and push ${releasedPaths.join(', ')} by hand, so others start from ${plan.version}.`,
  );
  process.exitCode = 1;
}
