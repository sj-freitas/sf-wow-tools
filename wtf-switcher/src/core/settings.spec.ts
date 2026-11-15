import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { defaultSettings, parseSettings, SettingsStore } from './settings';

describe('settings', () => {
  it('starts in the background, without a folder', () => {
    assert.deepEqual(parseSettings('not json'), defaultSettings());
    assert.deepEqual(defaultSettings(), { gameFolder: null, background: true, openAtLogin: false });
  });

  it('keeps what is valid of a saved file and ignores the rest', () => {
    assert.deepEqual(
      parseSettings(
        JSON.stringify({ gameFolder: '/WoW/_forever_', background: false, openAtLogin: 'yes' }),
      ),
      { gameFolder: '/WoW/_forever_', background: false, openAtLogin: false },
    );
  });

  it('writes the whole file and reads it back', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wtf-switcher-settings-'));
    try {
      const store = new SettingsStore(path.join(dir, 'nested', 'settings.json'));
      assert.deepEqual(store.load(), defaultSettings());
      const settings = { ...defaultSettings(), gameFolder: '/WoW/_forever_' };
      store.save(settings);
      assert.deepEqual(store.load(), settings);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
