import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  DEFAULT_SHARED,
  HISTORY_KEPT,
  isShared,
  nameProblem,
  parseConfig,
  ProfileStore,
  stamp,
} from './profiles';

let root: string;
let version: string;
let clock: Date;
let store: ProfileStore;

const ACCOUNT = 'WTF/Account/ACCOUNT';
const CHARACTER = `${ACCOUNT}/93/Shivan-Darkwhisp`;

/** Writes a file in the version folder, with a time a few seconds on from the last one. */
let tick = 0;
function put(file: string, text: string): void {
  const target = path.join(version, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  tick += 5;
  const time = new Date(Date.UTC(2026, 10, 15, 8, 0, tick));
  utimesSync(target, time, time);
}
const read = (file: string) => readFileSync(path.join(version, file), 'utf8');
const has = (file: string) => existsSync(path.join(version, file));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wtf-switcher-'));
  version = path.join(root, '_forever_');
  clock = new Date(2026, 10, 15, 8, 21);
  store = new ProfileStore(version, () => clock);
  put('WTF/Config.wtf', 'SET uiScale "0.65"');
  put(`${ACCOUNT}/SavedVariables/Bartender4.lua`, 'bars on the 4K monitor');
  put(`${ACCOUNT}/SavedVariables/GuildAssistantProfessions.lua`, 'professions, monday');
  put(`${ACCOUNT}/macros-cache.txt`, 'macros, monday');
  put(`${CHARACTER}/layout-local.txt`, 'frames on the 4K monitor');
  put(`${CHARACTER}/AddOns.txt`, 'Bartender4: enabled');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('which files are shared', () => {
  it('matches a file’s name, and the game’s .bak of it, against the patterns', () => {
    for (const file of [
      `${ACCOUNT}/SavedVariables/GuildAssistantProfessions.lua`,
      `${ACCOUNT}/SavedVariables/GuildAssistantProfessions.lua.bak`,
      `${ACCOUNT}/macros-cache.txt`,
      `${ACCOUNT}/bindings-cache.wtf`,
      `${ACCOUNT}/config-cache.old`,
      `${ACCOUNT}/edit-mode-cache-account.txt`,
      `${CHARACTER}/tts-cache-character.txt`,
      `${CHARACTER}/AddOns.txt`,
      `${ACCOUNT}/cache.md5`,
      'WTF\\Account\\X\\SavedVariables\\Questie.lua',
    ]) {
      assert.equal(isShared(file, DEFAULT_SHARED), true, file);
    }
    for (const file of [
      'WTF/Config.wtf',
      `${ACCOUNT}/SavedVariables/Bartender4.lua`,
      `${ACCOUNT}/SavedVariables/PitBull4.lua.bak`,
      `${CHARACTER}/layout-local.txt`,
      `${CHARACTER}/SavedVariables/Questie.lua.old`,
    ]) {
      assert.equal(isShared(file, DEFAULT_SHARED), false, file);
    }
  });
});

describe('names', () => {
  it('takes a plain name, and not one a folder can’t have or that is taken', () => {
    assert.equal(nameProblem('4K monitor', []), null);
    assert.equal(nameProblem('', []), 'Give it a name.');
    assert.match(nameProblem('a/b', []) ?? '', /without/);
    assert.match(nameProblem('.hidden', []) ?? '', /without/);
    assert.match(nameProblem('history', []) ?? '', /History/);
    assert.match(nameProblem('laptop', ['Laptop']) ?? '', /that name/);
    assert.match(nameProblem('x'.repeat(41), []) ?? '', /shorter/);
  });
});

describe('switcher.json', () => {
  it('keeps what is valid and starts the rest from the defaults', () => {
    assert.deepEqual(parseConfig('nope'), {
      active: null,
      screens: {},
      laptop: null,
      shared: DEFAULT_SHARED,
      verifiedAt: null,
    });
    const config = parseConfig(
      JSON.stringify({
        active: 'Laptop',
        screens: { 'Built-in Retina Display': 'Laptop', bad: 3 },
        laptop: 'Built-in Retina Display',
        shared: ['Foo.lua'],
        verifiedAt: '2026-11-15T08:21:00.000Z',
      }),
    );
    assert.deepEqual(config, {
      active: 'Laptop',
      screens: { 'Built-in Retina Display': 'Laptop' },
      laptop: 'Built-in Retina Display',
      shared: ['Foo.lua'],
      verifiedAt: '2026-11-15T08:21:00.000Z',
    });
  });

  it('is written next to the UIs and read back', async () => {
    assert.equal(await store.read(), null);
    const config = parseConfig('{"active":"4K monitor"}');
    await store.write(config);
    assert.deepEqual(await store.read(), config);
    assert.ok(has('WTF Profiles/switcher.json'));
  });
});

describe('the UIs on disk', () => {
  it('keeps a copy of WTF as a new UI, with its files’ times', async () => {
    await store.create('4K monitor');
    assert.deepEqual(await store.profiles(), ['4K monitor']);
    assert.equal(
      read('WTF Profiles/4K monitor/Account/ACCOUNT/SavedVariables/Bartender4.lua'),
      'bars on the 4K monitor',
    );
    await assert.rejects(store.create('4K monitor'), /There’s a UI called 4K monitor/);
  });

  it('switches WTF to another UI, leaving the shared files and what that UI lacks as they are', async () => {
    await store.create('4K monitor');
    await store.create('Laptop');
    // Played on the laptop: bars moved, professions and macros learned, a new character.
    put(`${ACCOUNT}/SavedVariables/Bartender4.lua`, 'bars on the laptop');
    put(`${CHARACTER}/layout-local.txt`, 'frames on the laptop');
    put(`${ACCOUNT}/SavedVariables/GuildAssistantProfessions.lua`, 'professions, tuesday');
    put(`${ACCOUNT}/macros-cache.txt`, 'macros, tuesday');
    put(`${ACCOUNT}/93/Newcomer-Darkwhisp/layout-local.txt`, 'newcomer’s frames');
    assert.equal(await store.saveInto('Laptop', DEFAULT_SHARED), 'saved');

    await store.restore('4K monitor', DEFAULT_SHARED);
    assert.equal(read(`${ACCOUNT}/SavedVariables/Bartender4.lua`), 'bars on the 4K monitor');
    assert.equal(read(`${CHARACTER}/layout-local.txt`), 'frames on the 4K monitor');
    assert.equal(
      read(`${ACCOUNT}/SavedVariables/GuildAssistantProfessions.lua`),
      'professions, tuesday',
    );
    assert.equal(read(`${ACCOUNT}/macros-cache.txt`), 'macros, tuesday');
    assert.equal(read(`${ACCOUNT}/93/Newcomer-Darkwhisp/layout-local.txt`), 'newcomer’s frames');
    assert.equal(read('WTF/Config.wtf'), 'SET uiScale "0.65"');
    // And the laptop's is still there.
    assert.equal(
      read('WTF Profiles/Laptop/Account/ACCOUNT/SavedVariables/Bartender4.lua'),
      'bars on the laptop',
    );
    assert.ok(!has('WTF Profiles/.work'));
  });

  it('drops a file the restored UI has and WTF doesn’t only when it isn’t shared', async () => {
    put(`${ACCOUNT}/SavedVariables/Grid2.lua`, 'raid frames');
    put(`${ACCOUNT}/SavedVariables/Auctionator.lua`, 'prices');
    await store.create('4K monitor');
    rmSync(path.join(version, `${ACCOUNT}/SavedVariables/Auctionator.lua`));
    await store.restore('4K monitor', DEFAULT_SHARED);
    assert.equal(read(`${ACCOUNT}/SavedVariables/Grid2.lua`), 'raid frames');
    assert.ok(!has(`${ACCOUNT}/SavedVariables/Auctionator.lua`));
  });

  it('does nothing when WTF is the UI already, and keeps no history for shared files', async () => {
    await store.create('Laptop');
    assert.equal(await store.saveInto('Laptop', DEFAULT_SHARED), 'unchanged');
    put(`${ACCOUNT}/SavedVariables/GuildAssistantProfessions.lua`, 'professions, tuesday');
    assert.equal(await store.saveInto('Laptop', DEFAULT_SHARED), 'saved');
    assert.deepEqual(await store.history('Laptop'), []);
    assert.equal(
      read('WTF Profiles/Laptop/Account/ACCOUNT/SavedVariables/GuildAssistantProfessions.lua'),
      'professions, tuesday',
    );
  });

  it('keeps the copy a changed layout replaces in History, the last few only', async () => {
    await store.create('Laptop');
    for (let n = 1; n <= HISTORY_KEPT + 2; n++) {
      put(`${ACCOUNT}/SavedVariables/Bartender4.lua`, `bars, try ${n}`);
      clock = new Date(2026, 10, 15, 9, n);
      await store.saveInto('Laptop', DEFAULT_SHARED);
    }
    const history = await store.history('Laptop');
    assert.equal(history.length, HISTORY_KEPT);
    assert.equal(history.at(-1), `Laptop ${stamp(new Date(2026, 10, 15, 9, HISTORY_KEPT + 2))}`);
    assert.equal(
      read(`WTF Profiles/History/${history.at(-1)}/Account/ACCOUNT/SavedVariables/Bartender4.lua`),
      `bars, try ${HISTORY_KEPT + 1}`,
    );
    // Two in the same minute don't take each other's place.
    put(`${ACCOUNT}/SavedVariables/Bartender4.lua`, 'bars, again');
    await store.saveInto('Laptop', DEFAULT_SHARED);
    assert.match((await store.history('Laptop')).at(-1) ?? '', /-2$/);
  });

  it('knows whether WTF changed since a time', async () => {
    assert.equal(await store.changedSince(null), true);
    assert.equal(await store.changedSince('2026-11-15T09:00:00.000Z'), false);
    assert.equal(await store.changedSince('2026-11-15T08:00:10.000Z'), true);
  });

  it('puts back what a change that stopped half way had moved away', async () => {
    await store.create('Laptop');
    // A switch stopped after moving WTF away, before putting the new one in its place.
    const work = path.join(version, 'WTF Profiles/.work/abc');
    mkdirSync(work, { recursive: true });
    writeFileSync(
      path.join(work, 'task.json'),
      JSON.stringify({ kind: 'restore', name: 'Laptop' }),
    );
    rmSync(path.join(version, 'WTF'), { recursive: true });
    put('WTF Profiles/.work/abc/old/Config.wtf', 'the WTF it had moved');
    await store.cleanUp();
    assert.equal(read('WTF/Config.wtf'), 'the WTF it had moved');
    assert.ok(!has('WTF Profiles/.work'));

    // A save stopped after moving the UI's copy away.
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(work, 'task.json'), JSON.stringify({ kind: 'save', name: 'Laptop' }));
    rmSync(path.join(version, 'WTF Profiles/Laptop'), { recursive: true });
    put('WTF Profiles/.work/abc/copy/Config.wtf', 'the new copy');
    await store.cleanUp();
    assert.equal(read('WTF Profiles/Laptop/Config.wtf'), 'the new copy');
  });
});
