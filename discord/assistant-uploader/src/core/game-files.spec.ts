import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  defaultGameFolders,
  detectGameFolder,
  findProfessionFiles,
  gameFolderOf,
  isGameFolder,
  versionLabel,
  type FileSystem,
} from './game-files';

/** A path written with "/", as this system writes it (the tests run on Mac and Windows). */
const p = (written: string): string => written.split('/').join(path.sep);

/** A disk of the given files (their folders follow from their paths). */
function fakeDisk(written: string[]): FileSystem {
  const files = written.map(p);
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split(path.sep);
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join(path.sep));
  }
  const all = [...dirs, ...files];
  return {
    readdir: async (dir) => {
      if (!dirs.has(dir)) throw new Error(`ENOENT ${dir}`);
      return [
        ...new Set(
          all
            .filter((entry) => entry.startsWith(`${dir}${path.sep}`))
            .map((entry) => entry.slice(dir.length + 1).split(path.sep)[0]),
        ),
      ];
    },
    isDirectory: async (target) => dirs.has(target),
    isFile: async (target) => files.includes(target),
  };
}

const WOW = p('/Applications/World of Warcraft');
const FILE = 'SavedVariables/GuildAssistantProfessions.lua';
const disk = fakeDisk([
  `${WOW}/_forever_/WTF/Account/ACCOUNT1/${FILE}`,
  `${WOW}/_forever_/WTF/Account/ACCOUNT2/SavedVariables/Other.lua`,
  `${WOW}/_classic_era_/WTF/Account/ACCOUNT1/${FILE}`,
  `${WOW}/_retail_/Interface/AddOns/x.lua`,
  `${WOW}/Data/data.000`,
]);

describe('game files', () => {
  it('finds the addon’s file in every version and account of the game’s folder', async () => {
    assert.deepEqual(await findProfessionFiles(WOW, disk), [
      {
        path: p(`${WOW}/_classic_era_/WTF/Account/ACCOUNT1/${FILE}`),
        dir: p(`${WOW}/_classic_era_/WTF/Account/ACCOUNT1/SavedVariables`),
        version: 'Classic Era',
        account: 'ACCOUNT1',
      },
      {
        path: p(`${WOW}/_forever_/WTF/Account/ACCOUNT1/${FILE}`),
        dir: p(`${WOW}/_forever_/WTF/Account/ACCOUNT1/SavedVariables`),
        version: 'Forever',
        account: 'ACCOUNT1',
      },
    ]);
  });

  it('takes a version’s folder too, or a folder picked inside it', async () => {
    const forever = await findProfessionFiles(p(`${WOW}/_forever_`), disk);
    assert.deepEqual(
      forever.map((file) => [file.version, file.account]),
      [['Forever', 'ACCOUNT1']],
    );
    assert.equal(gameFolderOf(p(`${WOW}/_forever_/WTF/Account/ACCOUNT1`)), p(`${WOW}/_forever_`));
    assert.equal(
      gameFolderOf('C:\\Program Files (x86)\\World of Warcraft\\_forever_\\WTF'),
      'C:\\Program Files (x86)\\World of Warcraft\\_forever_',
    );
    assert.equal(gameFolderOf(WOW), WOW);
  });

  it('tells the game’s folder from any other', async () => {
    assert.equal(await isGameFolder(WOW, disk), true);
    assert.equal(await isGameFolder(p(`${WOW}/_forever_`), disk), true);
    assert.equal(await isGameFolder(p(`${WOW}/Data`), disk), false);
    assert.equal(await isGameFolder('/nowhere', disk), false);
    assert.equal(await detectGameFolder(['/nowhere', WOW], disk), WOW);
    assert.equal(await detectGameFolder(['/nowhere'], disk), null);
  });

  it('knows where Battle.net installs the game, and names its versions', () => {
    assert.deepEqual(defaultGameFolders('darwin', '/Users/me', {}), [
      '/Applications/World of Warcraft',
      '/Users/me/Applications/World of Warcraft',
    ]);
    assert.deepEqual(
      defaultGameFolders('win32', 'C:\\Users\\me', { 'ProgramFiles(x86)': 'D:\\Games' }),
      ['D:\\Games\\World of Warcraft', 'C:\\Program Files\\World of Warcraft'],
    );
    assert.deepEqual(defaultGameFolders('linux', '/home/me', {}), []);
    assert.equal(versionLabel('_forever_'), 'Forever');
    assert.equal(versionLabel('_classic_era_'), 'Classic Era');
  });
});
