import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crafterName, itemLink, recipeLine } from './crafter-format';

describe('crafter-format', () => {
  it('shows an item like a game link: brackets around the link, nothing escaped inside it', () => {
    // Discord shows "[Bronze Mace]", the name opening Wowhead.
    assert.equal(
      itemLink('Bronze Mace', 'https://w/2740'),
      '\\[[Bronze Mace](<https://w/2740>)\\]',
    );
    // A backslash inside a link's text would show as typed: brackets are left out instead.
    assert.equal(itemLink('Odd [Name]', 'u'), '\\[[Odd Name](<u>)\\]');
  });

  it('shows a crafter as its character and its player’s mention in brackets', () => {
    assert.equal(crafterName('Vrax Duskwalker', '150'), 'Vrax Duskwalker (<@150>)');
    assert.equal(crafterName('Bob_Builder', null), 'Bob\\_Builder');
  });

  it('puts a recipe and its crafters on one line', () => {
    assert.equal(
      recipeLine(itemLink('Blackmouth Oil', 'u'), 2, 'A (<@1>), B (<@2>)'),
      '- \\[[Blackmouth Oil](<u>)\\], crafters: A (<@1>), B (<@2>)',
    );
    assert.equal(recipeLine('X', 1, 'A'), '- X, crafter: A');
  });
});
