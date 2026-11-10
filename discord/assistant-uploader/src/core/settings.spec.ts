import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { defaultSettings, parseSettings, SettingsStore } from './settings';

describe('settings', () => {
  it('starts in the background, without a folder or key', () => {
    assert.deepEqual(parseSettings('not json'), defaultSettings());
    assert.equal(defaultSettings().background, true);
    assert.equal(defaultSettings().openAtLogin, false);
  });

  it('keeps what is valid of a saved file and ignores the rest', () => {
    const settings = parseSettings(
      JSON.stringify({
        gameFolder: '/WoW',
        key: 'ZW5jcnlwdGVk',
        account: { name: 'Shivan', guilds: ['Alpha'] },
        background: false,
        openAtLogin: 'yes',
        uploads: {
          '/WoW/a.lua': {
            hash: 'h',
            at: '2026-11-10T10:00:00.000Z',
            summary: 'Updated 1 character in Alpha.',
          },
          '/WoW/b.lua': { hash: 3 },
        },
      }),
    );
    assert.equal(settings.gameFolder, '/WoW');
    assert.equal(settings.key, 'ZW5jcnlwdGVk');
    assert.deepEqual(settings.account, { name: 'Shivan', guilds: ['Alpha'] });
    assert.equal(settings.background, false);
    assert.equal(settings.openAtLogin, false);
    assert.deepEqual(Object.keys(settings.uploads), ['/WoW/a.lua']);
  });

  it('writes the whole file and reads it back', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'uploader-'));
    try {
      const store = new SettingsStore(path.join(dir, 'nested', 'settings.json'));
      assert.deepEqual(store.load(), defaultSettings());
      const settings = { ...defaultSettings(), gameFolder: '/WoW' };
      store.save(settings);
      assert.deepEqual(store.load(), settings);
      assert.match(readFileSync(path.join(dir, 'nested', 'settings.json'), 'utf8'), /"\/WoW"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
