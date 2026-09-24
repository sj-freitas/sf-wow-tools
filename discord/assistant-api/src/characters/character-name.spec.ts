import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lastNameRequiredMessage, requiresLastName } from '../game/game-version';
import { formatCharacterName, parseCharacterName } from './character-name';

describe('parseCharacterName', () => {
  it('parses a first name only', () => {
    assert.deepEqual(parseCharacterName('arthas'), { firstName: 'Arthas', lastName: '' });
  });

  it('splits first and last name on the dash', () => {
    assert.deepEqual(parseCharacterName('arthas-menethil'), {
      firstName: 'Arthas',
      lastName: 'Menethil',
    });
  });

  it('stores the first letter capitalized and all others lower case', () => {
    assert.deepEqual(parseCharacterName('aRTHAS-mENETHIL'), {
      firstName: 'Arthas',
      lastName: 'Menethil',
    });
    assert.deepEqual(parseCharacterName('ÉLISE-DUPONT'), {
      firstName: 'Élise',
      lastName: 'Dupont',
    });
  });

  it('trims surrounding whitespace', () => {
    assert.deepEqual(parseCharacterName('  Arthas-Menethil '), {
      firstName: 'Arthas',
      lastName: 'Menethil',
    });
  });

  describe('letters of any alphabet', () => {
    it('accepts accented Latin letters, precomposed or combining', () => {
      assert.deepEqual(parseCharacterName('Ürsula'), { firstName: 'Ürsula', lastName: '' });
      assert.deepEqual(parseCharacterName('Ürsula'), { firstName: 'Ürsula', lastName: '' });
    });

    it('accepts Cyrillic, Greek and CJK', () => {
      assert.deepEqual(parseCharacterName('артас-МЕНЕТИЛ'), {
        firstName: 'Артас',
        lastName: 'Менетил',
      });
      assert.deepEqual(parseCharacterName('Άρθας'), { firstName: 'Άρθας', lastName: '' });
      assert.deepEqual(parseCharacterName('阿尔萨斯'), { firstName: '阿尔萨斯', lastName: '' });
    });

    it('accepts scripts that use combining vowel signs', () => {
      assert.ok(parseCharacterName('अर्थस'));
    });

    it('rejects digits anywhere', () => {
      assert.equal(parseCharacterName('Ar7has'), null);
      assert.equal(parseCharacterName('Arthas-Mene7hil'), null);
      assert.equal(parseCharacterName('7Arthas'), null);
      assert.equal(parseCharacterName('Arthas2'), null);
    });

    it('rejects punctuation, spaces and symbols', () => {
      assert.equal(parseCharacterName("Ar'thas"), null);
      assert.equal(parseCharacterName('Ar thas'), null);
      assert.equal(parseCharacterName('Arthas!'), null);
      assert.equal(parseCharacterName('Arthas_'), null);
    });
  });

  describe('length', () => {
    it('needs at least 2 letters in the first name', () => {
      assert.equal(parseCharacterName('A'), null);
      assert.equal(parseCharacterName('A-Menethil'), null);
      assert.ok(parseCharacterName('Al'));
    });

    it('needs at least 2 letters in the last name when there is one', () => {
      assert.equal(parseCharacterName('Arthas-M'), null);
      assert.ok(parseCharacterName('Arthas-Me'));
    });

    it('counts letters, not combining marks', () => {
      assert.equal(parseCharacterName('É'), null);
    });

    it('rejects names longer than 12 letters', () => {
      assert.equal(parseCharacterName('Abcdefghijklm'), null);
      assert.ok(parseCharacterName('Abcdefghijkl'));
    });
  });

  describe('last name', () => {
    it('is optional', () => {
      assert.equal(parseCharacterName('Arthas')?.lastName, '');
    });

    it('is invalid when the dash has nothing after it', () => {
      assert.equal(parseCharacterName('Arthas-'), null);
    });

    it('is invalid without a first name', () => {
      assert.equal(parseCharacterName('-Menethil'), null);
      assert.equal(parseCharacterName(''), null);
    });

    it('cannot contain another dash', () => {
      assert.equal(parseCharacterName('Arthas-Mene-thil'), null);
    });
  });
});

describe('formatCharacterName', () => {
  it('joins the parts and trims', () => {
    assert.equal(
      formatCharacterName({ firstName: 'Arthas', lastName: 'Menethil' }),
      'Arthas Menethil',
    );
    assert.equal(formatCharacterName({ firstName: 'Arthas', lastName: '' }), 'Arthas');
  });
});

describe('game version name rules', () => {
  it('requires a last name in Forever', () => {
    assert.equal(requiresLastName('Forever'), true);
  });

  it('does not require one for unknown versions', () => {
    assert.equal(requiresLastName('Something else'), false);
  });

  it('explains the rule', () => {
    assert.match(lastNameRequiredMessage('Forever'), /Forever.*last name.*Name-Lastname/);
  });
});
