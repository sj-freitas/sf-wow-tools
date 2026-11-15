import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Where Battle.net installs the game on a Mac. */
export function defaultGameFolders(home: string): string[] {
  return ['/Applications/World of Warcraft', path.join(home, 'Applications', 'World of Warcraft')];
}

const isDirectory = (target: string): Promise<boolean> =>
  fs.stat(target).then(
    (stats) => stats.isDirectory(),
    () => false,
  );

/** "_forever_" is "Forever", "_classic_era_" "Classic Era". */
export function versionLabel(versionFolder: string): string {
  const words = path.basename(versionFolder).split('_').filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * The game version folder (the one with `WTF` in it, like `_forever_`) for a folder picked in or
 * around it: itself, the one it's in (`…/_forever_/WTF`), or, in the game's own folder, `_forever_`
 * (else its first). Null when there's none.
 */
export async function versionFolderOf(folder: string): Promise<string | null> {
  if (path.basename(folder) === 'WTF') return versionFolderOf(path.dirname(folder));
  if (await isDirectory(path.join(folder, 'WTF'))) return folder;
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  const versions: string[] = [];
  for (const name of [...names].sort()) {
    if (/^_.+_$/.test(name) && (await isDirectory(path.join(folder, name, 'WTF')))) {
      versions.push(name);
    }
  }
  const pick = versions.includes('_forever_') ? '_forever_' : versions[0];
  return pick ? path.join(folder, pick) : null;
}

/** The first of the default places with the game in it. */
export async function detectVersionFolder(home: string): Promise<string | null> {
  for (const folder of defaultGameFolders(home)) {
    const found = await versionFolderOf(folder);
    if (found) return found;
  }
  return null;
}

/** The game's program in a version folder (not its helpers, like the voice chat one). */
export function gameProgram(versionFolder: string): string {
  return path.join(
    versionFolder,
    'World of Warcraft.app',
    'Contents',
    'MacOS',
    'World of Warcraft',
  );
}

/** Whether the game of this version folder is among the running programs (their command lines). */
export function gameRunningIn(commands: string[], versionFolder: string): boolean {
  const program = gameProgram(versionFolder);
  return commands.some((command) => {
    const line = command.trim();
    return line === program || line.startsWith(`${program} `);
  });
}

/** Every running program's command line (`ps`). */
export function runningCommands(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('ps', ['-axww', '-o', 'command='], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout.split('\n')),
    );
  });
}
