import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guildPath, slugify } from './guild-path';

describe('slugify', () => {
  it('lower-cases and joins words with hyphens', () => {
    assert.equal(slugify('Relic Hunters'), 'relic-hunters');
    assert.equal(slugify('  Aerie   Peak  '), 'aerie-peak');
  });

  it('keeps hyphens as hyphens and drops apostrophes', () => {
    assert.equal(slugify('Azjol-Nerub'), 'azjol-nerub');
    assert.equal(slugify("Mograine's Rest"), 'mograines-rest');
    assert.equal(slugify('Mograine’s Rest'), 'mograines-rest');
  });

  it('drops accents but keeps letters of any alphabet', () => {
    assert.equal(slugify('Élan Vital'), 'elan-vital');
    assert.equal(slugify('Орда Севера'), 'орда-севера');
  });

  it('collapses punctuation and never starts or ends with a hyphen', () => {
    assert.equal(slugify('!!Best -- Guild!!'), 'best-guild');
  });

  it('falls back to something for names with no letters or digits', () => {
    assert.equal(slugify('***'), 'guild');
  });
});

describe('guildPath', () => {
  it('is version/region/server/guild-name, all lower case', () => {
    assert.equal(
      guildPath({ gameVersion: 'Forever', region: 'EU', realm: 'Firemaw', name: 'Relic Hunters' }),
      'forever/eu/firemaw/relic-hunters',
    );
  });

  it('is the same for names that differ only in case or punctuation', () => {
    const a = guildPath({
      gameVersion: 'Forever',
      region: 'EU',
      realm: 'Firemaw',
      name: 'Relic Hunters',
    });
    const b = guildPath({
      gameVersion: 'Forever',
      region: 'EU',
      realm: 'FIREMAW',
      name: 'relic-hunters',
    });
    assert.equal(a, b);
  });
});
