import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crafterLinks, crafterName, itemLink, profileUrl, recipeLine } from './crafter-format';

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

  it('links a crafter of the Professions List to its page and its player’s profile, no mention', () => {
    const profile = { name: 'Verexs', url: profileUrl('https://ga.app', '150') };
    assert.equal(
      crafterLinks('Vrax Duskwalker', 'https://ga.app/c/Vrax-Duskwalker/professions', profile),
      '[Vrax Duskwalker](<https://ga.app/c/Vrax-Duskwalker/professions>) ' +
        '([Verexs](<https://ga.app/api/public/discord/users/150>))',
    );
    // Not on Discord: the page alone; neither known: the name, escaped as plain text.
    assert.equal(crafterLinks('Bob', 'p', null), '[Bob](<p>)');
    assert.equal(crafterLinks('Bob_B', null, null), 'Bob\\_B');
    assert.equal(crafterLinks('Bob', null, { name: null, url: 'u' }), 'Bob ([Discord](<u>))');
  });

  it('puts a recipe and its crafters on one line', () => {
    assert.equal(
      recipeLine(itemLink('Blackmouth Oil', 'u'), 2, 'A (<@1>), B (<@2>)'),
      '- \\[[Blackmouth Oil](<u>)\\], crafters: A (<@1>), B (<@2>)',
    );
    assert.equal(recipeLine('X', 1, 'A'), '- X, crafter: A');
  });
});
