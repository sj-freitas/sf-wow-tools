import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { gameProgram, gameRunningIn, versionFolderOf, versionLabel } from './game';

const root = mkdtempSync(path.join(tmpdir(), 'wtf-switcher-game-'));
const game = path.join(root, 'World of Warcraft');
for (const version of ['_classic_era_', '_forever_', '_retail_']) {
  mkdirSync(path.join(game, version, 'WTF'), { recursive: true });
}
mkdirSync(path.join(game, '_anniversary_'));
after(() => rmSync(root, { recursive: true, force: true }));

describe('the game', () => {
  it('names a version by its folder', () => {
    assert.equal(versionLabel('/x/_forever_'), 'Forever');
    assert.equal(versionLabel('/x/_classic_era_'), 'Classic Era');
  });

  it('finds the version folder from the game’s folder, the version’s or its WTF', async () => {
    const forever = path.join(game, '_forever_');
    assert.equal(await versionFolderOf(game), forever);
    assert.equal(await versionFolderOf(forever), forever);
    assert.equal(await versionFolderOf(path.join(forever, 'WTF')), forever);
    assert.equal(await versionFolderOf(path.join(game, '_retail_')), path.join(game, '_retail_'));
    assert.equal(await versionFolderOf(path.join(game, '_anniversary_')), null);
    assert.equal(await versionFolderOf(root), null);
  });

  it('knows the game is running from its program, not its helpers or another version', () => {
    const forever = path.join(game, '_forever_');
    const program = gameProgram(forever);
    const helper = path.join(
      forever,
      'World of Warcraft.app/Contents/Helpers/WowVoiceProxy.app/Contents/MacOS/WowVoiceProxy',
    );
    assert.equal(gameRunningIn([`${program} -launch`], forever), true);
    assert.equal(gameRunningIn([`  ${program}`], forever), true);
    assert.equal(gameRunningIn([helper, '/usr/bin/login'], forever), false);
    assert.equal(gameRunningIn([gameProgram(path.join(game, '_retail_'))], forever), false);
    assert.equal(gameRunningIn([], forever), false);
  });
});
