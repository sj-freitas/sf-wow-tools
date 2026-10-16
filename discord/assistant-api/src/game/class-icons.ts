import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Icons: image files in a folder of a version, each named after what it stands for.
 *
 *   class-icons/<Class>.png         `Druid.png`: the class, in sign-ups (instead of its name);
 *                                   a class without one keeps its colour dot
 *   raid-markers/<Marker>.png       `Skull.png`: a raid target marker, in assignments; a marker
 *                                   without one is written as text ("[Skull]")
 *   role-icons/<Role>.png           `Tank.png`, `Healer.png`, `Melee.png`, `Ranged.png`, and
 *                                   `Leader.png`, `Assist.png`, `MasterLooter.png` for the raid's
 *                                   leader, assists and master looter: sign-ups and groups; one
 *                                   without an image keeps its emoji (🛡️, 👑, …)
 *
 * Each becomes a Discord emoji the bot uploads, and the website shows the same file. The files
 * are checked when the configs load, so a bad one stops start-up with a reason.
 */

export const CLASS_ICONS_FOLDER = 'class-icons';
export const MARKER_ICONS_FOLDER = 'raid-markers';
/** The raid target markers, as their icon files are named. */
export const MARKER_NAMES = [
  'Skull',
  'Cross',
  'Square',
  'Moon',
  'Triangle',
  'Diamond',
  'Circle',
  'Star',
] as const;
export const ROLE_ICONS_FOLDER = 'role-icons';
/** The role icons, as their files are named: the four roles, and the leader, assists and master looter. */
export const ROLE_ICON_NAMES = [
  'Tank',
  'Healer',
  'Melee',
  'Ranged',
  'Leader',
  'Assist',
  'MasterLooter',
] as const;
/** Discord's limit for an emoji. Square images around 128×128 look best. */
export const MAX_ICON_BYTES = 256 * 1024;

export interface ClassIcon {
  /** Where the file is (in the source tree, or `dist/` once built). */
  file: string;
  contentType: string;
  /** Changes with the image, so a new image is uploaded as a new emoji. */
  hash: string;
}

const EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

/** What the bytes are, by their first bytes (Discord emojis take PNG, JPEG and GIF). */
function sniff(data: Buffer): string | null {
  const starts = (bytes: number[]) => bytes.every((byte, i) => data[i] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  return null;
}

/** Reads a version's class icons (no folder = no icons), with what is wrong in it. */
export const readClassIcons = (versionDirectory: string, classNames: readonly string[]) =>
  readIcons(versionDirectory, CLASS_ICONS_FOLDER, classNames, 'a class');

/** Reads a version's raid marker icons (no folder = none), with what is wrong in it. */
export const readMarkerIcons = (versionDirectory: string) =>
  readIcons(versionDirectory, MARKER_ICONS_FOLDER, MARKER_NAMES, 'a raid marker');

/** Reads a version's role icons (no folder = none), with what is wrong in it. */
export const readRoleIcons = (versionDirectory: string) =>
  readIcons(versionDirectory, ROLE_ICONS_FOLDER, ROLE_ICON_NAMES, 'a role (or Leader)');

function readIcons(
  versionDirectory: string,
  folderName: string,
  names: readonly string[],
  what: string,
): { icons: Map<string, ClassIcon>; problems: string[] } {
  const icons = new Map<string, ClassIcon>();
  const problems: string[] = [];
  const folder = join(versionDirectory, folderName);
  if (!existsSync(folder)) return { icons, problems };

  for (const name of readdirSync(folder).sort()) {
    const extension = extname(name).toLowerCase();
    const file = join(folder, name);
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md' || !statSync(file).isFile()) {
      continue;
    }
    const where = `${folderName}/${name}`;
    if (!EXTENSIONS[extension]) {
      problems.push(`${where} must be a .png, .jpg or .gif`);
      continue;
    }
    const iconName = name.slice(0, -extension.length);
    if (!names.includes(iconName)) {
      problems.push(`${where} is not named after ${what} (${names.join(', ')})`);
      continue;
    }
    if (icons.has(iconName)) {
      problems.push(`${iconName} has more than one icon`);
      continue;
    }
    const data = readFileSync(file);
    const contentType = sniff(data);
    if (!contentType) {
      problems.push(`${where} is not a PNG, JPEG or GIF image`);
      continue;
    }
    if (data.length > MAX_ICON_BYTES) {
      problems.push(`${where} is larger than ${MAX_ICON_BYTES / 1024} KB (Discord’s emoji limit)`);
      continue;
    }
    const hash = createHash('sha1').update(data).digest('hex').slice(0, 8);
    icons.set(iconName, { file, contentType, hash });
  }
  return { icons, problems };
}
