// What an upload releases. A change to an addon doesn't touch its version or its CHANGELOG: it adds
// a change note, addons/changes/<Name>/<anything>.md, which says how big it is and what to tell
// players:
//
//   ---
//   bump: minor
//   ---
//
//   - **Sort the guildmates** by Name, Skill or Profession.
//
// Notes are separate files, so changes made side by side never conflict. The upload
// (publish-curseforge.mjs) gathers them: the version is the highest one already on CurseForge,
// bumped by the biggest note, and the notes' lines become that version's CHANGELOG section. An
// older-style bump not uploaded yet (a .toc version above CurseForge's, with its own CHANGELOG
// section) counts as one more note.
//
// Pure functions (and reading the notes), so the upload only does the network and git around them;
// tested in release.test.mjs.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './addons.mjs';

/** How big a change is, smallest first. */
export const KINDS = ['patch', 'minor', 'major'];

/** CurseForge's numbers for a file's release type: the lower, the more final. */
export const RELEASE_TYPES = { release: 1, beta: 2, alpha: 3 };

/** Where an addon's change notes are (outside the addon's folder, so they're never packaged). */
export const notesDir = (name) => join(root, 'changes', name);

/** A change note's text: its bump and its CHANGELOG lines. `file` names it in errors. */
export function parseNote(text, file) {
  const match = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: a change note starts with "---", "bump: patch" (or minor, major), "---"`);
  const bump = match[1].match(/^bump:\s*(\S+)\s*$/m)?.[1];
  if (!KINDS.includes(bump)) {
    throw new Error(`${file}: "bump:" must be patch, minor or major (it's ${bump ? `"${bump}"` : 'missing'})`);
  }
  const body = match[2].trim();
  if (!body) throw new Error(`${file}: no CHANGELOG lines after its "---"`);
  return { file, bump, body };
}

/** The addon's change notes, by file name. */
export function readNotes(name) {
  const dir = notesDir(name);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => parseNote(readFileSync(join(dir, file), 'utf8'), `changes/${name}/${file}`));
}

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  return match ? match.slice(1).map(Number) : null;
}

/** Negative when a is older than b, 0 when the same, positive when newer. */
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function bumpVersion(version, kind) {
  const [major, minor, patch] = parseVersion(version);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** What kind of bump takes `from` to `to` (null when `to` isn't newer). */
export function kindBetween(from, to) {
  if (compareVersions(to, from) <= 0) return null;
  const [a, b] = [parseVersion(from), parseVersion(to)];
  return a[0] !== b[0] ? 'major' : a[1] !== b[1] ? 'minor' : 'patch';
}

const biggest = (kinds) => kinds.reduce((a, b) => (KINDS.indexOf(b) > KINDS.indexOf(a) ? b : a));

/**
 * CurseForge's files of an addon, as its site's API lists them (`data` of
 * /api/v1/mods/<project>/files), with the version each is of ("<Name>-1.2.3.zip", or the last word
 * of its display name).
 */
export function filesFromCurseForge(data, name) {
  const types = Object.fromEntries(Object.entries(RELEASE_TYPES).map(([type, n]) => [n, type]));
  return data
    .map((file) => {
      const version =
        new RegExp(`^${name}-(.+)\\.zip$`).exec(file.fileName ?? '')?.[1] ?? String(file.displayName ?? '').split(' ').pop();
      return { id: file.id, version, releaseType: types[file.releaseType] ?? 'release', date: file.dateCreated };
    })
    .filter((file) => parseVersion(file.version));
}

/** The newest version on CurseForge, of any release type (null when it has none). */
export function newestVersion(files) {
  return files.reduce((newest, file) => (!newest || compareVersions(file.version, newest) > 0 ? file.version : newest), null);
}

/** Files already on CurseForge that uploading `version` as `releaseType` would repeat. */
export function clashes(files, version, releaseType) {
  return files.filter(
    (file) => file.version === version && RELEASE_TYPES[file.releaseType] <= RELEASE_TYPES[releaseType],
  );
}

/** A CHANGELOG split into its head ("# Title") and its "## <version>" sections, newest first. */
export function splitChangelog(text) {
  const parts = text.replace(/\r\n/g, '\n').split(/^(?=## )/m);
  const head = parts[0].startsWith('## ') ? '' : parts.shift();
  const sections = parts.map((part) => ({
    version: /^## \[?([^\]\s]+)/.exec(part)?.[1],
    body: part.replace(/^## .*\n?/, '').trim(),
    raw: part.trimEnd(),
  }));
  return { head, sections };
}

/**
 * What uploading the addon releases:
 * - `released`: the newest version on CurseForge (null for an addon never uploaded);
 * - `tocVersion`: its .toc's;
 * - `notes`: its change notes;
 * - `changelog`: its CHANGELOG.md's text.
 * Returns the version to upload, its CHANGELOG section (the release notes), the whole new
 * CHANGELOG, and whether anything new goes in it (`fresh`: false is the same version again, which
 * only a beta or alpha becoming a release may be).
 */
export function planRelease({ released, tocVersion, notes, changelog }) {
  if (!parseVersion(tocVersion)) throw new Error(`the .toc's version "${tocVersion}" isn't major.minor.patch`);
  if (released && compareVersions(tocVersion, released) < 0) {
    throw new Error(`the .toc says ${tocVersion}, but CurseForge already has ${released}: this copy is behind (pull main)`);
  }
  const pending = released ? kindBetween(released, tocVersion) : null;
  const kinds = [...notes.map((note) => note.bump), ...(pending ? [pending] : [])];
  const version = !released ? tocVersion : kinds.length > 0 ? bumpVersion(released, biggest(kinds)) : released;
  const fresh = !released || kinds.length > 0;

  const { head, sections } = splitChangelog(changelog);
  // Sections of versions never uploaded (an older-style bump, or the first upload's own) go into
  // this one.
  const isPending = (section) =>
    parseVersion(section.version) &&
    (released ? compareVersions(section.version, released) > 0 : section.version === version);
  const folded = sections.filter(isPending);
  const kept = sections.filter((section) => !isPending(section));
  const ordered = [...notes].sort((a, b) => KINDS.indexOf(b.bump) - KINDS.indexOf(a.bump) || a.file.localeCompare(b.file));
  const body = [...ordered.map((note) => note.body), ...folded.map((section) => section.body)]
    .filter(Boolean)
    .join('\n');

  if (!fresh) {
    const own = sections.find((section) => section.version === version);
    return { version, fresh, section: own?.raw ?? null, changelog };
  }
  if (!body) return { version, fresh, section: null, changelog };
  const section = `## ${version}\n\n${body}`;
  const newHead = head.trim() ? `${head.trim()}\n\n` : '';
  const rest = kept.map((s) => s.raw).join('\n\n');
  return { version, fresh, section, changelog: `${newHead}${section}\n${rest ? `\n${rest}\n` : ''}` };
}

/** The .toc's text with `version` in its "## Version:". */
export const tocWithVersion = (toc, version) => toc.replace(/^(##\s*Version\s*:\s*).*$/m, `$1${version}`);
