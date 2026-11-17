// The release's arithmetic (release.mjs): change notes, versions, what CurseForge already has, and
// the CHANGELOG an upload writes. `npm test -- release`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findAddons } from './addons.mjs';
import {
  bumpVersion,
  clashes,
  compareVersions,
  filesFromCurseForge,
  newestVersion,
  parseNote,
  planRelease,
  promotes,
  readNotes,
  tocWithVersion,
} from './release.mjs';

const note = (bump, body, file = `changes/X/${bump}.md`) => ({ file, bump, body });

describe('change notes', () => {
  it('reads the bump and the CHANGELOG lines', () => {
    const text = '---\nbump: minor\n---\n\n- **Sort** the guildmates.\n- And more.\n';
    assert.deepEqual(parseNote(text, 'a.md'), { file: 'a.md', bump: 'minor', body: '- **Sort** the guildmates.\n- And more.' });
  });

  it('reads Windows line endings', () => {
    assert.equal(parseNote('---\r\nbump: patch\r\n---\r\n\r\n- Fixed.\r\n', 'a.md').bump, 'patch');
  });

  it('refuses a note without its header, with a wrong bump, or with nothing to say', () => {
    assert.throws(() => parseNote('- Fixed.\n', 'a.md'), /a\.md: a change note starts with/);
    assert.throws(() => parseNote('---\nbump: huge\n---\n\n- Fixed.\n', 'a.md'), /"huge"/);
    assert.throws(() => parseNote('---\nkind: patch\n---\n\n- Fixed.\n', 'a.md'), /missing/);
    assert.throws(() => parseNote('---\nbump: patch\n---\n\n', 'a.md'), /no CHANGELOG lines/);
  });

  it("every addon's notes in the repository read", () => {
    for (const addon of findAddons()) assert.doesNotThrow(() => readNotes(addon.name), addon.name);
  });
});

describe('versions', () => {
  it('bumps and compares', () => {
    assert.equal(bumpVersion('1.9.3', 'patch'), '1.9.4');
    assert.equal(bumpVersion('1.9.3', 'minor'), '1.10.0');
    assert.equal(bumpVersion('1.9.3', 'major'), '2.0.0');
    assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
    assert.equal(compareVersions('2.2.1', '2.2.1'), 0);
  });

  it('sets the .toc version', () => {
    const toc = '## Interface: 16001\n## Version: 1.5.0\n## Author: x\n';
    assert.equal(tocWithVersion(toc, '1.5.1'), '## Interface: 16001\n## Version: 1.5.1\n## Author: x\n');
  });
});

describe('what CurseForge has', () => {
  const files = filesFromCurseForge(
    [
      { id: 3, fileName: 'Addon-1.0.2.zip', displayName: 'Addon 1.0.2', releaseType: 1 },
      { id: 2, fileName: 'Addon-1.0.2.zip', displayName: 'Addon 1.0.2', releaseType: 2 },
      { id: 4, fileName: 'other.zip', displayName: 'Addon 1.1.0', releaseType: 3 },
      { id: 1, fileName: 'Addon.zip', displayName: 'Addon (old)', releaseType: 1 },
    ],
    'Addon',
  );

  it('reads each file’s version and release type, skipping those without a version', () => {
    assert.deepEqual(
      files.map(({ id, version, releaseType }) => [id, version, releaseType]),
      [
        [3, '1.0.2', 'release'],
        [2, '1.0.2', 'beta'],
        [4, '1.1.0', 'alpha'],
      ],
    );
  });

  it('knows the newest version, of any release type', () => {
    assert.equal(newestVersion(files), '1.1.0');
    assert.equal(newestVersion([]), null);
  });

  it('never repeats a version, but a beta or alpha may become a release', () => {
    assert.deepEqual(clashes(files, '1.0.2', 'release').map((f) => f.id), [3]);
    assert.deepEqual(clashes(files, '1.0.2', 'beta').map((f) => f.id), [3, 2]);
    assert.deepEqual(clashes(files, '1.1.0', 'release'), []);
    assert.deepEqual(clashes(files, '1.1.0', 'alpha').map((f) => f.id), [4]);
    assert.deepEqual(clashes(files, '1.2.0', 'release'), []);
  });

  it('uploads a version again only to make a beta or alpha it lists more final', () => {
    assert.equal(promotes(files, '1.1.0', 'release'), true);
    assert.equal(promotes(files, '1.1.0', 'beta'), true);
    assert.equal(promotes(files, '1.1.0', 'alpha'), false);
    assert.equal(promotes(files, '1.0.2', 'release'), true);
    assert.equal(promotes(files, '1.2.0', 'release'), false);
  });
});

describe('planning a release', () => {
  const changelog = '# Addon\n\n## 1.9.0\n\n- Sorting.\n\n## 1.8.0\n\n- Filters.\n  Two lines.\n';

  it("bumps the last upload's version by the biggest note, and the notes become its section", () => {
    const plan = planRelease({
      released: '1.9.0',
      tocVersion: '1.9.0',
      notes: [note('patch', '- Fixed a thing.', 'changes/X/a-fix.md'), note('minor', '- **New** thing.', 'changes/X/z-new.md')],
      changelog,
    });
    assert.equal(plan.version, '1.10.0');
    assert.equal(plan.fresh, true);
    assert.equal(plan.section, '## 1.10.0\n\n- **New** thing.\n- Fixed a thing.');
    assert.equal(plan.changelog, `# Addon\n\n## 1.10.0\n\n- **New** thing.\n- Fixed a thing.\n\n${changelog.slice('# Addon\n\n'.length)}`);
  });

  it("goes by the .toc's version when CurseForge doesn't list the last upload yet", () => {
    // 1.5.1 uploaded minutes ago: CurseForge still lists 1.5.0 as its newest.
    const log = '# Addon\n\n## 1.5.1\n\n- **Fixed** an error.\n\n## 1.5.0\n\n- Specializations.\n';
    const plan = planRelease({ released: '1.5.0', tocVersion: '1.5.1', notes: [note('patch', '- New recipes.')], changelog: log });
    assert.equal(plan.version, '1.5.2');
    assert.equal(plan.section, '## 1.5.2\n\n- New recipes.');
    assert.equal(plan.changelog, `# Addon\n\n## 1.5.2\n\n- New recipes.\n\n${log.slice('# Addon\n\n'.length)}`);

    const again = planRelease({ released: '1.5.0', tocVersion: '1.5.1', notes: [], changelog: log });
    assert.equal(again.version, '1.5.1');
    assert.equal(again.fresh, false);
  });

  it('with no notes, it is the same version again (only a beta becoming a release)', () => {
    const plan = planRelease({ released: '1.9.0', tocVersion: '1.9.0', notes: [], changelog });
    assert.equal(plan.version, '1.9.0');
    assert.equal(plan.fresh, false);
    assert.equal(plan.section, '## 1.9.0\n\n- Sorting.');
    assert.equal(plan.changelog, changelog);
  });

  it('refuses a .toc behind CurseForge (a copy that missed a release)', () => {
    assert.throws(
      () => planRelease({ released: '1.9.0', tocVersion: '1.8.0', notes: [note('patch', '- Fix.')], changelog }),
      /CurseForge already has 1\.9\.0/,
    );
  });

  it("an addon's first upload is its .toc version, with its notes", () => {
    const plan = planRelease({
      released: null,
      tocVersion: '1.0.0',
      notes: [note('minor', '- Everything.')],
      changelog: '# Addon\n\n## 1.0.0\n\n- First.\n',
    });
    assert.equal(plan.version, '1.0.0');
    assert.equal(plan.changelog, '# Addon\n\n## 1.0.0\n\n- Everything.\n- First.\n');
  });

  it('writes a CHANGELOG from nothing', () => {
    const plan = planRelease({ released: '0.1.0', tocVersion: '0.1.0', notes: [note('patch', '- Fix.')], changelog: '' });
    assert.equal(plan.changelog, '## 0.1.1\n\n- Fix.\n');
  });
});
