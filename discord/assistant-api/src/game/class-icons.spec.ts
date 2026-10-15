import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { colorDotPng } from '../signup/color-dot';
import { MAX_ICON_BYTES, readClassIcons, readMarkerIcons } from './class-icons';
import { classIcon, markerIcon } from './games';

const CLASSES = ['Druid', 'Death Knight', 'Mage'];

function withIcons(files: Record<string, Buffer>, check: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'icons-'));
  try {
    mkdirSync(join(directory, 'class-icons'));
    for (const [name, data] of Object.entries(files)) {
      writeFileSync(join(directory, 'class-icons', name), data);
    }
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('readClassIcons', () => {
  it('finds one icon per class by its file name, with a hash of its bytes', () => {
    withIcons(
      {
        'Druid.png': colorDotPng('#FF7C0A'),
        'Death Knight.png': colorDotPng('#C41E3A'),
        'README.md': Buffer.from('notes'),
      },
      (directory) => {
        const { icons, problems } = readClassIcons(directory, CLASSES);
        assert.deepEqual(problems, []);
        assert.deepEqual([...icons.keys()], ['Death Knight', 'Druid']);
        assert.equal(icons.get('Druid')?.contentType, 'image/png');
        assert.match(icons.get('Druid')?.hash ?? '', /^[0-9a-f]{8}$/);
        assert.notEqual(icons.get('Druid')?.hash, icons.get('Death Knight')?.hash);
      },
    );
  });

  it('has none when the folder is missing', () => {
    const { icons, problems } = readClassIcons(join(tmpdir(), 'no-such-version'), CLASSES);
    assert.equal(icons.size, 0);
    assert.deepEqual(problems, []);
  });

  it('explains files that are not class icons', () => {
    withIcons(
      {
        'Druids.png': colorDotPng('#FF7C0A'),
        'Mage.png': Buffer.from('not an image'),
        'Druid.svg': Buffer.from('<svg/>'),
        // A real GIF signature, but too big for a Discord emoji.
        'Druid.gif': Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(MAX_ICON_BYTES)]),
      },
      (directory) => {
        const problems = readClassIcons(directory, CLASSES).problems.join('\n');
        assert.match(problems, /Druids\.png is not named after a class/);
        assert.match(problems, /Mage\.png is not a PNG, JPEG or GIF/);
        assert.match(problems, /Druid\.svg must be a \.png, \.jpg or \.gif/);
        assert.match(problems, /Druid\.gif is larger than 256 KB/);
      },
    );
  });
});

describe('classIcon', () => {
  it('finds Forever’s icons whatever the casing of the version (addresses use `forever`)', () => {
    assert.equal(classIcon('forever', 'Druid')?.contentType, 'image/png');
    assert.equal(classIcon('Forever', 'Druid')?.hash, classIcon('FOREVER', 'Druid')?.hash);
    assert.equal(classIcon('forever', 'Nobody'), null);
  });
});

describe('readMarkerIcons', () => {
  it('reads raid-markers/<Marker>.png and refuses other names', () => {
    const directory = mkdtempSync(join(tmpdir(), 'markers-'));
    try {
      mkdirSync(join(directory, 'raid-markers'));
      writeFileSync(join(directory, 'raid-markers', 'Skull.png'), colorDotPng('#FFFFFF'));
      writeFileSync(join(directory, 'raid-markers', 'Skulls.png'), colorDotPng('#FFFFFF'));
      const { icons, problems } = readMarkerIcons(directory);
      assert.deepEqual([...icons.keys()], ['Skull']);
      assert.match(problems.join(), /Skulls\.png is not named after a raid marker/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('has Forever’s marker icons', () => {
    assert.equal(markerIcon('forever', 'Skull')?.contentType, 'image/png');
    assert.equal(markerIcon('Forever', 'Nothing'), null);
  });
});
