// What the packaging and publishing scripts share: finding the addons, reading their .toc, and
// zipping them the way WoW and CurseForge expect (one folder named after the addon at the top).
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

export const root = fileURLToPath(new URL('..', import.meta.url));

/** Files that never go in a package (the tests are in dev/, outside the addon, already). */
const EXCLUDED = [/(^|\/)\.DS_Store$/, /(^|\/)\./, /\.spec\.lua$/];

/** Every addon: a folder of addons/ with a .toc of the same name. */
export function findAddons(names = []) {
  const all = readdirSync(root).filter((name) => existsSync(join(root, name, `${name}.toc`)));
  const unknown = names.filter((name) => !all.includes(name));
  if (unknown.length > 0) throw new Error(`No such addon: ${unknown.join(', ')} (have: ${all.join(', ')})`);
  return (names.length > 0 ? names : all).map(readAddon);
}

/** An addon's .toc fields (`## Key: value`), with its interface numbers as a list. */
export function readAddon(name) {
  const toc = readFileSync(join(root, name, `${name}.toc`), 'utf8');
  const fields = {};
  for (const [, key, value] of toc.matchAll(/^##\s*([^:]+?)\s*:\s*(.*?)\s*$/gm)) fields[key] = value;
  const interfaces = (fields.Interface ?? '').split(',').map((n) => Number(n.trim())).filter(Boolean);
  if (!fields.Version) throw new Error(`${name}.toc has no "## Version:"`);
  if (interfaces.length === 0) throw new Error(`${name}.toc has no "## Interface:"`);
  return { name, version: fields.Version, interfaces, fields, dir: join(root, name) };
}

/** 11509 -> "1.15.9": how CurseForge names the game version an interface number is for. */
export const interfaceToVersion = (n) =>
  `${Math.floor(n / 10000)}.${Math.floor(n / 100) % 100}.${n % 100}`;

function filesOf(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((path) => statSync(join(dir, path)).isFile())
    .filter((path) => !EXCLUDED.some((pattern) => pattern.test(path)))
    .sort();
}

/** Zips the addon into dist/<Name>-<version>.zip; returns its path and what is in it. */
export function packageAddon(addon) {
  const files = filesOf(addon.dir);
  const entries = Object.fromEntries(
    files.map((path) => [`${addon.name}/${path.split('\\').join('/')}`, readFileSync(join(addon.dir, path))]),
  );
  mkdirSync(join(root, 'dist'), { recursive: true });
  const path = join(root, 'dist', `${addon.name}-${addon.version}.zip`);
  writeFileSync(path, zipSync(entries, { level: 9 }));
  return { path, relativePath: relative(root, path), files: Object.keys(entries) };
}
