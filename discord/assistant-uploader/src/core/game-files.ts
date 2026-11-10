import { promises as fs } from 'node:fs';
import path from 'node:path';

/** The file the GuildAssistant Professions addon's data is saved in (its SavedVariables). */
export const FILE_NAME = 'GuildAssistantProfessions.lua';

/** One copy of the addon's file: one per game version and WoW account. */
export interface ProfessionsFile {
  path: string;
  /** Its folder (`…/SavedVariables`), which is watched: the game replaces the file in it. */
  dir: string;
  /** The game version's folder, as a name: "Forever" (`_forever_`), "Classic Era". */
  version: string;
  /** The WoW account's folder it's under (`WTF/Account/<account>`). */
  account: string;
}

/** What finding the files reads of the disk (a fake one in tests). */
export interface FileSystem {
  readdir(dir: string): Promise<string[]>;
  isDirectory(target: string): Promise<boolean>;
  isFile(target: string): Promise<boolean>;
}

export const nodeFileSystem: FileSystem = {
  readdir: (dir) => fs.readdir(dir),
  isDirectory: (target) =>
    fs.stat(target).then(
      (stats) => stats.isDirectory(),
      () => false,
    ),
  isFile: (target) =>
    fs.stat(target).then(
      (stats) => stats.isFile(),
      () => false,
    ),
};

/** "_classic_era_" is "Classic Era", "_forever_" "Forever". */
export function versionLabel(folderName: string): string {
  const words = folderName.split('_').filter(Boolean);
  if (words.length === 0) return folderName;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** Where Battle.net installs the game by default. */
export function defaultGameFolders(
  platform: string,
  home: string,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/World of Warcraft',
      path.posix.join(home, 'Applications/World of Warcraft'),
    ];
  }
  if (platform === 'win32') {
    return [
      env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      env.ProgramFiles ?? 'C:\\Program Files',
    ].map((root) => path.win32.join(root, 'World of Warcraft'));
  }
  return [];
}

/**
 * The game's folder for a folder picked inside it: someone who picks `…/_forever_/WTF` (or deeper)
 * means `…/_forever_`.
 */
export function gameFolderOf(folder: string): string {
  const separator = folder.includes('\\') ? '\\' : '/';
  const parts = folder.split(/[\\/]/);
  const wtf = parts.lastIndexOf('WTF');
  return wtf > 0 ? parts.slice(0, wtf).join(separator) : folder;
}

/** The game version folders in `folder`: itself when it is one (it has `WTF`), else its `_x_` ones. */
async function versionFolders(folder: string, disk: FileSystem): Promise<string[]> {
  if (await disk.isDirectory(path.join(folder, 'WTF'))) return [folder];
  const names = await disk.readdir(folder).catch(() => [] as string[]);
  const found: string[] = [];
  for (const name of [...names].sort()) {
    if (!/^_.+_$/.test(name)) continue;
    const dir = path.join(folder, name);
    if (await disk.isDirectory(path.join(dir, 'WTF'))) found.push(dir);
  }
  return found;
}

/** Whether `folder` is World of Warcraft's (or one of its version folders, like `_forever_`). */
export async function isGameFolder(
  folder: string,
  disk: FileSystem = nodeFileSystem,
): Promise<boolean> {
  return (await versionFolders(folder, disk)).length > 0;
}

/** The first of `candidates` that is the game's folder; null when none is. */
export async function detectGameFolder(
  candidates: string[],
  disk: FileSystem = nodeFileSystem,
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await isGameFolder(candidate, disk)) return candidate;
  }
  return null;
}

/**
 * Every copy of the addon's file in the game's folder: in each version folder (`_forever_`,
 * `_classic_era_`…), each account's `WTF/Account/<account>/SavedVariables/GuildAssistantProfessions.lua`.
 */
export async function findProfessionFiles(
  folder: string,
  disk: FileSystem = nodeFileSystem,
): Promise<ProfessionsFile[]> {
  const files: ProfessionsFile[] = [];
  for (const versionDir of await versionFolders(folder, disk)) {
    const accounts = path.join(versionDir, 'WTF', 'Account');
    const names = await disk.readdir(accounts).catch(() => [] as string[]);
    for (const account of [...names].sort()) {
      const dir = path.join(accounts, account, 'SavedVariables');
      const file = path.join(dir, FILE_NAME);
      if (await disk.isFile(file)) {
        files.push({ path: file, dir, version: versionLabel(path.basename(versionDir)), account });
      }
    }
  }
  return files;
}
