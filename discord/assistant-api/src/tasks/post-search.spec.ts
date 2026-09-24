import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampPage, likePattern, PAGE_SIZE, searchTerms } from './post-search';

describe('searchTerms', () => {
  it('splits the search box into words', () => {
    assert.deepEqual(searchTerms('  raid   tonight '), ['raid', 'tonight']);
  });

  it('is empty for nothing', () => {
    assert.deepEqual(searchTerms(undefined), []);
    assert.deepEqual(searchTerms('   '), []);
  });

  it('limits how much is searched', () => {
    assert.equal(searchTerms(Array(20).fill('a').join(' ')).length, 8);
    assert.equal(searchTerms('x'.repeat(500))[0].length, 100);
  });
});

describe('likePattern', () => {
  it('matches the word anywhere', () => {
    assert.equal(likePattern('raid'), '%raid%');
  });

  it('keeps LIKE wildcards literal', () => {
    assert.equal(likePattern('100%'), '%100\\%%');
    assert.equal(likePattern('a_b'), '%a\\_b%');
    assert.equal(likePattern('a\\b'), '%a\\\\b%');
  });
});

describe('clampPage', () => {
  it('accepts whole numbers from 1', () => {
    assert.equal(clampPage('3'), 3);
    assert.equal(clampPage(2), 2);
  });

  it('falls back to the first page for anything else', () => {
    for (const bad of [undefined, '', '0', '-2', 'abc', '1.5', NaN]) {
      assert.equal(clampPage(bad), 1);
    }
  });

  it('shows ten posts to a page', () => {
    assert.equal(PAGE_SIZE, 10);
  });
});
