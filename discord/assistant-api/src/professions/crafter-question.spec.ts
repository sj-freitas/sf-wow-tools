import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PHRASES,
  findQuestion,
  matchRecipes,
  parsePhrases,
  relayedAuthor,
  type RecipeRef,
} from './crafter-question';

const recipes: RecipeRef[] = [
  { kind: 'spell', id: 17635, name: 'Flask of the Titans' },
  { kind: 'spell', id: 17636, name: 'Flask of Distilled Wisdom' },
  { kind: 'spell', id: 17637, name: 'Flask of Supreme Power' },
  { kind: 'spell', id: 17557, name: 'Elixir of the Mongoose' },
  { kind: 'spell', id: 20034, name: 'Enchant Weapon - Crusader' },
  { kind: 'spell', id: 16153, name: 'Smelt Thorium' },
  { kind: 'spell', id: 3115, name: 'Rough Sharpening Stone' },
  { kind: 'spell', id: 3931, name: 'Coarse Dynamite' },
  { kind: 'spell', id: 1245287, name: null },
];

const ask = (text: string) => {
  const question = findQuestion(text, DEFAULT_PHRASES);
  return question ? matchRecipes(question, recipes).map((m) => m.recipe.name ?? m.recipe.id) : null;
};

describe('findQuestion and matchRecipes', () => {
  it('finds the recipe named after the phrase', () => {
    assert.deepEqual(ask('who can craft Flask of the Titans?'), ['Flask of the Titans']);
    assert.deepEqual(ask('Who can make flask of titans pls'), ['Flask of the Titans']);
    assert.deepEqual(ask('LF crafter for mongoose elixir'), ['Elixir of the Mongoose']);
  });

  it('tolerates typos and plurals', () => {
    assert.deepEqual(ask('who can craft flasks of the titns'), ['Flask of the Titans']);
    assert.deepEqual(ask('can anyone make crusadr'), ['Enchant Weapon - Crusader']);
  });

  it('stops at the end of the question', () => {
    assert.deepEqual(ask('who can craft flask of the titans? I have mats tonight'), [
      'Flask of the Titans',
    ]);
  });

  it('skips words that name nothing before or after the item', () => {
    assert.deepEqual(ask('who can make me the new flask of titans tonight'), [
      'Flask of the Titans',
    ]);
  });

  it('looks before the phrase when nothing follows it', () => {
    assert.deepEqual(ask('Flask of the Titans, who can make?'), ['Flask of the Titans']);
    assert.deepEqual(ask('LF crafter: Smelt Thorium'), ['Smelt Thorium']);
  });

  it('lists every match of a vague question, the closest first', () => {
    assert.deepEqual(ask('who can make a flask'), [
      'Flask of the Titans',
      'Flask of Distilled Wisdom',
      'Flask of Supreme Power',
    ]);
  });

  it('prefers an item in brackets, as game chat shows it', () => {
    assert.deepEqual(ask('LF crafter [Flask of the Titans] got mats'), ['Flask of the Titans']);
    assert.deepEqual(
      ask('who can craft |cff1eff00|Hitem:13510::::::::60:::::|h[Flask of the Titans]|h|r ?'),
      ['Flask of the Titans'],
    );
  });

  it('does not guess for an item named in full that the guild can’t craft', () => {
    assert.deepEqual(ask('LF crafter [Ez-Thro Dynamite]'), []);
    // Without brackets it's a vague question: other dynamite will do.
    assert.deepEqual(ask('LF crafter dynamite'), ['Coarse Dynamite']);
  });

  it('reads Wowhead links: the id, else the name in the address', () => {
    assert.deepEqual(ask('who can craft https://www.wowhead.com/classic/spell=17557/elixir'), [
      'Elixir of the Mongoose',
    ]);
    assert.deepEqual(
      ask('who can make [this](https://www.wowhead.com/classic/item=13510/flask-of-the-titans)'),
      ['Flask of the Titans'],
    );
  });

  it('is no question without a phrase, even with an item', () => {
    assert.equal(ask('just made [Flask of the Titans]!'), null);
    assert.equal(ask('flask of the titans anyone'), null);
  });

  it('answers nothing when the question names no recipe', () => {
    assert.deepEqual(ask('who can make it to the raid tonight?'), []);
    assert.equal(ask('who can craft?'), null);
  });

  it('uses the phrases it is given', () => {
    const question = findQuestion('wts? no, need flask of titans', ['need flask']);
    assert.ok(question);
    assert.deepEqual(
      matchRecipes(question, recipes).map((m) => m.recipe.name),
      ['Flask of the Titans'],
    );
  });
});

describe('parsePhrases', () => {
  it('takes one phrase per line, trimmed, without repeats', () => {
    assert.deepEqual(parsePhrases(' who can craft \n\nWho  can craft\nLF crafter'), {
      phrases: ['who can craft', 'LF crafter'],
    });
  });

  it('defaults to the usual phrases', () => {
    assert.deepEqual(parsePhrases(undefined), { phrases: [...DEFAULT_PHRASES] });
  });

  it('refuses one-word phrases, the bot’s own words and an empty list', () => {
    assert.ok('error' in parsePhrases(['craft']));
    assert.ok('error' in parsePhrases(['Can craft']));
    assert.ok('error' in parsePhrases(['  ']));
  });
});

describe('relayedAuthor', () => {
  it('reads the name a relayed message starts with', () => {
    assert.deepEqual(relayedAuthor('Svajone: who can craft x', null), {
      names: ['Svajone'],
      text: 'who can craft x',
    });
    assert.deepEqual(relayedAuthor('[G] [Svajone-RP]: who can craft x', null).names, ['Svajone']);
    assert.deepEqual(relayedAuthor('**Svajone Potato**: hi', null).names, ['Svajone Potato']);
  });

  it('takes the webhook’s name first', () => {
    assert.deepEqual(relayedAuthor('who can craft x', 'Svajone'), {
      names: ['Svajone'],
      text: 'who can craft x',
    });
  });
});
