import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ranksFor } from './ranks';

const roles = { officer: 'o', raider: 'r', social: 's' };

describe('ranksFor', () => {
  it('returns nothing for a member without the mapped roles', () => {
    assert.deepEqual(ranksFor(['x', 'y'], roles), []);
    assert.deepEqual(ranksFor([], roles), []);
  });

  it('returns a single matching rank', () => {
    assert.deepEqual(ranksFor(['r'], roles), ['Raider']);
  });

  it('returns several ranks in the fixed order Officer, Raider, Social', () => {
    assert.deepEqual(ranksFor(['s', 'x', 'o', 'r'], roles), ['Officer', 'Raider', 'Social']);
  });

  it('ignores roles that are not mapped', () => {
    assert.deepEqual(ranksFor(['o', 'r'], { officer: null, raider: 'r', social: null }), [
      'Raider',
    ]);
    assert.deepEqual(ranksFor(['o'], { officer: null, raider: null, social: null }), []);
  });
});
