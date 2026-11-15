import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ProfileStore } from './profiles';
import { type Screens, Switcher } from './switcher';

const BUILT_IN = 'Built-in Retina Display';
const LAPTOP: Screens = { setup: BUILT_IN, laptop: BUILT_IN };
const DESK: Screens = { setup: `${BUILT_IN} + LG HDR 4K`, laptop: BUILT_IN };
const SIDECAR: Screens = { setup: `${BUILT_IN} + Sidecar Display`, laptop: BUILT_IN };
/** The laptop closed, on the monitor only. */
const CLOSED: Screens = { setup: 'LG HDR 4K', laptop: null };
const BARS = 'WTF/Account/ACCOUNT/SavedVariables/Bartender4.lua';
const PROFESSIONS = 'WTF/Account/ACCOUNT/SavedVariables/GuildAssistantProfessions.lua';

let root: string;
let version: string;
let store: ProfileStore;
let gameOpen: boolean;
let asked: [string, string][];
let answer: (active: string, wanted: string) => string;
let events: string[];
let clock: number;

function put(file: string, text: string): void {
  const target = path.join(version, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}
const read = (file: string) => readFileSync(path.join(version, file), 'utf8');

function switcher(): Switcher {
  return new Switcher(
    {
      store,
      gameRunning: async () => gameOpen,
      ask: async (active, wanted) => {
        asked.push([active, wanted]);
        return answer(active, wanted);
      },
      now: () => new Date((clock += 60_000)),
    },
    {
      changed: () => undefined,
      switched: (from, to) => events.push(`switched ${from} → ${to}`),
      waiting: (to) => events.push(`waiting for ${to}`),
      newSetup: (setup, byDefault) => events.push(`new ${setup} (${byDefault})`),
    },
  );
}

/** The game opens (its reading WTF), and closes, having saved `bars` as where the bars are. */
async function play(app: Switcher, bars: string): Promise<void> {
  gameOpen = true;
  await app.checkGame();
  put(BARS, bars);
  gameOpen = false;
  await app.checkGame();
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wtf-switcher-'));
  version = path.join(root, '_forever_');
  // Times on from the files': the switcher's clock is a minute on with each call.
  clock = Date.now();
  store = new ProfileStore(version, () => new Date(clock));
  gameOpen = false;
  asked = [];
  answer = (active) => active;
  events = [];
  put('WTF/Config.wtf', 'SET uiScale "0.65"');
  put(BARS, 'bars for the 4K monitor');
  put(PROFESSIONS, 'professions, monday');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the switcher', () => {
  it('keeps the first UI as what WTF is now', async () => {
    const app = switcher();
    await app.start(LAPTOP);
    assert.equal(app.view().ready, false);
    assert.equal(await app.create('4K monitor', false), null);
    const view = app.view();
    assert.equal(view.ready, true);
    assert.equal(view.active, '4K monitor');
    assert.equal(view.wanted, null);
    assert.deepEqual(view.profiles, [{ name: '4K monitor', setups: [] }]);
    assert.equal(await app.create('4k MONITOR', true), 'There’s a UI with that name.');
  });

  it('starting a laptop UI while the game is open asks, once it closes, which UI it left', async () => {
    // The case it was made for: on the laptop, the game open with the 4K monitor's UI.
    gameOpen = true;
    const app = switcher();
    await app.start(LAPTOP);
    await app.create('4K monitor', false);
    await app.create('Laptop', true);
    assert.equal(app.view().waiting, true);
    assert.deepEqual(events, ['waiting for Laptop']);

    // Rearranged for the laptop, then closed.
    put(BARS, 'bars for the laptop');
    gameOpen = false;
    answer = (_active, wanted) => wanted;
    await app.checkGame();
    assert.deepEqual(asked, [['4K monitor', 'Laptop']]);
    assert.equal(app.view().active, 'Laptop');
    assert.equal(app.view().waiting, false);
    assert.equal(read(BARS), 'bars for the laptop');
    assert.equal(
      read('WTF Profiles/Laptop/Account/ACCOUNT/SavedVariables/Bartender4.lua'),
      'bars for the laptop',
    );
    assert.equal(
      read('WTF Profiles/4K monitor/Account/ACCOUNT/SavedVariables/Bartender4.lua'),
      'bars for the 4K monitor',
    );
  });

  it('switches as soon as the screens change while the game is closed, and back', async () => {
    const app = switcher();
    await app.start(DESK);
    await app.create('4K monitor', true);
    await app.screensChanged(LAPTOP);
    assert.deepEqual(events, [`new ${BUILT_IN} (null)`]);
    await app.create('Laptop', true);
    await play(app, 'bars for the laptop');
    put(PROFESSIONS, 'professions, tuesday');

    events = [];
    await app.screensChanged(DESK);
    assert.deepEqual(events, ['switched Laptop → 4K monitor']);
    assert.equal(read(BARS), 'bars for the 4K monitor');
    assert.equal(read(PROFESSIONS), 'professions, tuesday');

    await play(app, 'bars for the 4K monitor, moved');
    await app.screensChanged(LAPTOP);
    assert.equal(read(BARS), 'bars for the laptop');
    await app.screensChanged(DESK);
    assert.equal(read(BARS), 'bars for the 4K monitor, moved');
    assert.deepEqual(asked, []);
    assert.deepEqual(app.view().profiles, [
      { name: '4K monitor', setups: [DESK.setup] },
      { name: 'Laptop', setups: [BUILT_IN] },
    ]);
  });

  it('waits for the game to close, and asks then which UI it left', async () => {
    const app = switcher();
    await app.start(DESK);
    await app.create('4K monitor', true);
    await app.screensChanged(LAPTOP);
    await app.create('Laptop', true);
    await play(app, 'bars for the laptop');
    await app.screensChanged(DESK);

    // Opened at the desk, then the laptop was taken away and played on as it was.
    gameOpen = true;
    await app.checkGame();
    await app.screensChanged(LAPTOP);
    assert.equal(app.view().waiting, true);
    assert.equal(read(BARS), 'bars for the 4K monitor');
    put(BARS, 'bars for the 4K monitor, as left');
    gameOpen = false;
    await app.checkGame();
    assert.deepEqual(asked, [['4K monitor', 'Laptop']]);
    assert.equal(read(BARS), 'bars for the laptop');
    assert.equal(
      read('WTF Profiles/4K monitor/Account/ACCOUNT/SavedVariables/Bartender4.lua'),
      'bars for the 4K monitor, as left',
    );
  });

  it('doesn’t switch or ask when the screens are back as they were before the game closes', async () => {
    const app = switcher();
    await app.start(DESK);
    await app.create('4K monitor', true);
    await app.screensChanged(LAPTOP);
    await app.create('Laptop', true);
    await app.screensChanged(DESK);
    events = [];
    gameOpen = true;
    await app.checkGame();
    await app.screensChanged(LAPTOP);
    await app.screensChanged(DESK);
    gameOpen = false;
    await app.checkGame();
    assert.deepEqual(asked, []);
    assert.deepEqual(events, ['waiting for Laptop']);
    assert.equal(app.view().active, '4K monitor');
  });

  it('asks on starting when the game saved WTF since the switcher last knew it', async () => {
    let app = switcher();
    await app.start(DESK);
    await app.create('4K monitor', true);
    await app.screensChanged(LAPTOP);
    await app.create('Laptop', true);
    await app.screensChanged(DESK);

    // Started again on the laptop, nothing saved meanwhile: no question.
    app = switcher();
    await app.start(LAPTOP);
    assert.deepEqual(asked, []);
    assert.equal(app.view().active, 'Laptop');

    // Played at the desk while the switcher wasn't running, then started on the laptop.
    await app.screensChanged(DESK);
    put(BARS, 'bars played without the switcher');
    const later = new Date(clock + 30_000);
    utimesSync(path.join(version, BARS), later, later);
    app = switcher();
    await app.start(LAPTOP);
    assert.deepEqual(asked, [['4K monitor', 'Laptop']]);
  });

  it('asks when the game saved WTF before a UI for these screens was made', async () => {
    // The first UI kept (as the switcher's first step does), then the game played on the laptop,
    // rearranged and closed, before the laptop's UI was made.
    let app = switcher();
    await app.start(LAPTOP);
    await app.create('4K monitor', false);
    put(BARS, 'bars for the laptop');
    const later = new Date(clock + 30_000);
    utimesSync(path.join(version, BARS), later, later);
    clock += 60_000;
    app = switcher();
    await app.start(LAPTOP);
    answer = (_active, wanted) => wanted;
    await app.create('Laptop', true);
    assert.deepEqual(asked, [['4K monitor', 'Laptop']]);
    assert.equal(
      read('WTF Profiles/4K monitor/Account/ACCOUNT/SavedVariables/Bartender4.lua'),
      'bars for the 4K monitor',
    );
    assert.equal(read(BARS), 'bars for the laptop');
    assert.equal(app.view().active, 'Laptop');
  });

  it('doesn’t switch when the game opens while it asks', async () => {
    const app = switcher();
    await app.start(DESK);
    await app.create('4K monitor', true);
    await app.screensChanged(LAPTOP);
    await app.create('Laptop', true);
    await app.screensChanged(DESK);
    gameOpen = true;
    await app.checkGame();
    await app.screensChanged(LAPTOP);
    gameOpen = false;
    answer = (active) => {
      gameOpen = true;
      return active;
    };
    await app.checkGame();
    assert.equal(app.view().active, '4K monitor');
    assert.equal(app.view().waiting, true);
  });

  it('uses the laptop’s UI on screens that have none of their own (an iPad by Sidecar)', async () => {
    const app = switcher();
    await app.start(DESK);
    await app.create('4K monitor', true);
    // No laptop UI yet: nothing to default to.
    events = [];
    await app.screensChanged(SIDECAR);
    assert.deepEqual(events, [`new ${SIDECAR.setup} (null)`]);
    assert.equal(app.view().wanted, null);
    await app.screensChanged(LAPTOP);
    await app.create('Laptop', true);
    await play(app, 'bars for the laptop');
    await app.screensChanged(DESK);
    assert.equal(read(BARS), 'bars for the 4K monitor');

    events = [];
    await app.screensChanged(SIDECAR);
    assert.deepEqual(events, [`new ${SIDECAR.setup} (Laptop)`, 'switched 4K monitor → Laptop']);
    assert.equal(read(BARS), 'bars for the laptop');
    const view = app.view();
    assert.equal(view.wanted, 'Laptop');
    assert.equal(view.byDefault, true);
    assert.equal(view.defaultUi, 'Laptop');

    // The laptop closed, on a monitor it doesn't know: the laptop's too (remembered).
    await app.screensChanged(DESK);
    await app.screensChanged({ setup: 'BenQ PD3200U', laptop: null });
    assert.equal(app.view().active, 'Laptop');
    // Its own UI, then back to the default.
    await app.screensChanged(CLOSED);
    assert.equal(app.view().active, 'Laptop');
    await app.use('4K monitor');
    assert.equal(app.view().active, '4K monitor');
    assert.equal(app.view().byDefault, false);
    await app.use(null);
    assert.equal(app.view().active, 'Laptop');
    assert.equal(app.view().byDefault, true);
  });

  it('says why a switch failed, and tries it again', async () => {
    const app = switcher();
    await app.start(DESK);
    await app.create('4K monitor', true);
    await app.screensChanged(LAPTOP);
    await app.create('Laptop', true);
    await app.screensChanged(DESK);
    const restore = store.restore.bind(store);
    store.restore = async () => {
      throw new Error('disk full');
    };
    await app.screensChanged(LAPTOP);
    assert.equal(app.view().error, 'disk full');
    assert.equal(app.view().active, '4K monitor');
    store.restore = restore;
    await app.retry();
    assert.equal(app.view().error, null);
    assert.equal(app.view().active, 'Laptop');
  });
});
