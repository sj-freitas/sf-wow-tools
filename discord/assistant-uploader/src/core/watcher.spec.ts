import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { ProfessionsFile } from './game-files';
import type { UploadRecord } from './settings';
import { hashOf, ProfessionsWatcher, type WatcherDeps } from './watcher';

const FOREVER: ProfessionsFile = {
  path: '/WoW/_forever_/WTF/Account/A/SavedVariables/GuildAssistantProfessions.lua',
  dir: '/WoW/_forever_/WTF/Account/A/SavedVariables',
  version: 'Forever',
  account: 'A',
};

/** The disk, the clock, the timers and Guild Assistant, all in hand. */
function setup(records: Record<string, UploadRecord> = {}) {
  const contents = new Map<string, string>([[FOREVER.path, 'DB = { v1 }']]);
  let found: ProfessionsFile[] = [FOREVER];
  const listeners = new Map<string, (name: string | null) => void>();
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 1;
  const uploads: string[] = [];
  let uploadFails: string | null = null;
  const events = { changed: 0, uploaded: [] as UploadRecord[], failed: [] as string[] };
  const deps: WatcherDeps = {
    findFiles: async () => found,
    readFile: async (file) => {
      const text = contents.get(file);
      if (text === undefined) throw new Error('ENOENT');
      return text;
    },
    watch: (dir, onChange) => {
      listeners.set(dir, onChange);
      return { close: () => listeners.delete(dir) };
    },
    upload: async (data) => {
      if (uploadFails) throw new Error(uploadFails);
      uploads.push(data);
      return `Updated ${uploads.length} time(s).`;
    },
    now: () => new Date('2026-11-10T12:00:00.000Z'),
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  };
  const watcher = new ProfessionsWatcher(
    deps,
    records,
    {
      changed: () => void events.changed++,
      uploaded: (_file, record) => void events.uploaded.push(record),
      failed: (_file, message) => void events.failed.push(message),
    },
    { debounceMs: 2000, sweepMs: 300_000 },
  );
  /** Runs the timers due after `ms` (the debounce, or the sweep), waiting for what they start. */
  const elapse = async (ms: number) => {
    for (const [id, timer] of [...timers]) {
      if (timer.ms <= ms) {
        timers.delete(id);
        timer.run();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  return {
    watcher,
    contents,
    uploads,
    events,
    records,
    elapse,
    listeners,
    setFound: (files: ProfessionsFile[]) => (found = files),
    failUploads: (message: string | null) => (uploadFails = message),
    gameSaves: (text: string) => {
      contents.set(FOREVER.path, text);
      listeners.get(FOREVER.dir)?.('GuildAssistantProfessions.lua');
    },
  };
}

describe('ProfessionsWatcher', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('uploads a file it hasn’t sent yet as soon as it starts, and remembers what it sent', async () => {
    await t.watcher.start('/WoW');
    assert.deepEqual(t.uploads, ['DB = { v1 }']);
    assert.deepEqual(t.records[FOREVER.path], {
      hash: hashOf('DB = { v1 }'),
      at: '2026-11-10T12:00:00.000Z',
      summary: 'Updated 1 time(s).',
    });
    assert.deepEqual(
      t.watcher.files().map((file) => [file.status, file.message]),
      [['uploaded', 'Updated 1 time(s).']],
    );
    assert.equal(t.watcher.watching, true);
  });

  it('uploads again when the game saves a changed file, once it stops changing', async () => {
    await t.watcher.start('/WoW');
    t.gameSaves('DB = { v2 }');
    t.gameSaves('DB = { v3 }');
    assert.equal(t.uploads.length, 1, 'not before it settles');
    await t.elapse(2000);
    assert.deepEqual(t.uploads, ['DB = { v1 }', 'DB = { v3 }']);
  });

  it('doesn’t upload what it already sent: the game rewrites the file at every reload', async () => {
    await t.watcher.start('/WoW');
    t.gameSaves('DB = { v1 }');
    await t.elapse(2000);
    assert.equal(t.uploads.length, 1);
    // Nor after a restart: what was sent is kept (the settings file).
    const again = setup(t.records);
    await again.watcher.start('/WoW');
    assert.deepEqual(again.uploads, []);
    assert.equal(again.watcher.files()[0].status, 'uploaded');
  });

  it('ignores other files in the folder', async () => {
    await t.watcher.start('/WoW');
    t.contents.set(FOREVER.path, 'DB = { v2 }');
    t.listeners.get(FOREVER.dir)?.('SomeOtherAddon.lua');
    await t.elapse(2000);
    assert.equal(t.uploads.length, 1);
  });

  it('“Upload now” sends it even unchanged', async () => {
    await t.watcher.start('/WoW');
    await t.watcher.checkAll(true);
    assert.equal(t.uploads.length, 2);
  });

  it('says once when an upload fails, and tries again at the next sweep', async () => {
    t.failUploads('Guild Assistant didn’t answer.');
    await t.watcher.start('/WoW');
    assert.deepEqual(
      t.watcher.files().map((file) => [file.status, file.message]),
      [['failed', 'Guild Assistant didn’t answer.']],
    );
    await t.elapse(300_000);
    assert.deepEqual(t.events.failed, ['Guild Assistant didn’t answer.'], 'once, not every retry');
    t.failUploads(null);
    await t.elapse(300_000);
    assert.deepEqual(t.uploads, ['DB = { v1 }']);
    assert.equal(t.watcher.files()[0].status, 'uploaded');
  });

  it('finds a file that appears later (the addon’s first save) at the next sweep', async () => {
    t.setFound([]);
    await t.watcher.start('/WoW');
    assert.deepEqual(t.watcher.files(), []);
    t.setFound([FOREVER]);
    await t.elapse(300_000);
    assert.deepEqual(t.uploads, ['DB = { v1 }']);
  });

  it('waits while paused (no key yet), then catches up', async () => {
    await t.watcher.pause('Waiting for an upload key.');
    await t.watcher.start('/WoW');
    assert.equal(t.watcher.watching, false);
    assert.deepEqual(
      t.watcher.files().map((file) => [file.status, file.message]),
      [['waiting', 'Waiting for an upload key.']],
    );
    assert.deepEqual(t.uploads, []);
    await t.watcher.pause(null);
    assert.deepEqual(t.uploads, ['DB = { v1 }']);
  });

  it('stops watching when stopped', async () => {
    await t.watcher.start('/WoW');
    t.watcher.stop();
    assert.equal(t.listeners.size, 0);
    assert.equal(t.watcher.watching, false);
    assert.deepEqual(t.watcher.files(), []);
  });
});
