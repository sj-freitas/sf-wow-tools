import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  exportFromSavedVariables,
  matchCharacter,
  nameKey,
  parseProfessionExport,
  parseSources,
  wowheadUrl,
} from './profession-export';

/** What the addon exports (its test writes the same text: the two stay in step). */
const FIXTURE = readFileSync(
  join(__dirname, '../../../../addons/dev/GuildAssistantProfessions/export.fixture.json'),
  'utf8',
);

/** The saved variables file as the game writes it: Lua, with the export as an escaped string. */
const savedVariables = (exportJson: string) =>
  [
    '',
    'GuildAssistantProfessionsDB = {',
    '\t["characters"] = {',
    '\t\t["Luna-Test Realm"] = {',
    '\t\t\t["name"] = "Luna",',
    '\t\t},',
    '\t},',
    `\t["export"] = "${exportJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}",`,
    '\t["updated"] = 1792000000,',
    '}',
    '',
  ].join('\n');

describe('exportFromSavedVariables', () => {
  it("takes the export out of the game's file", () => {
    assert.equal(exportFromSavedVariables(savedVariables(FIXTURE.trim())), FIXTURE.trim());
  });

  it('reads Lua escapes, UTF-8 written byte by byte too', () => {
    // "Shìvan" with "ì" as its two UTF-8 bytes, \195\172.
    const file = '["export"] = "{\\"name\\":\\"Sh\\195\\172van\\",\\"note\\":\\"a\\\\b\\"}"';
    assert.equal(exportFromSavedVariables(file), '{"name":"Shìvan","note":"a\\b"}');
  });

  it('is null for a file without an export', () => {
    assert.equal(exportFromSavedVariables('GuildAssistantProfessionsDB = nil\n'), null);
  });
});

describe('parseProfessionExport', () => {
  it("reads the saved variables file the addon's data is in", () => {
    const data = parseProfessionExport(savedVariables(FIXTURE.trim()));
    assert.equal(data.characters.length, 4);
    assert.deepEqual(data.characters[2].professions[0].spells, [13890, 20034]);
  });

  it("reads the addon's export", () => {
    const data = parseProfessionExport(FIXTURE);
    assert.deepEqual(
      data.characters.map((c) => [c.name, c.source]),
      [
        ['Bob', 'own'],
        // A guildmate's, received through the addon's guild sharing (1.0+).
        ['Kael', 'guild'],
        ['Luna', 'own'],
        ['Mira', 'link'],
      ],
    );
    const luna = data.characters[2];
    assert.equal(luna.realm, 'Test Realm');
    assert.deepEqual(luna.professions[0], {
      name: 'Enchanting',
      skill: 300,
      max: 300,
      spells: [13890, 20034],
      items: [],
      learned: new Date(1791500000 * 1000),
      updated: new Date(1791600000 * 1000),
    });
    assert.deepEqual(luna.professions[1].items, [14146]);
    // The profession's history: when it was learned and last changed (server time, seconds).
    const herbalism = data.characters[1].professions[0];
    assert.equal(herbalism.learned?.toISOString(), new Date(1791000000 * 1000).toISOString());
    assert.equal(herbalism.updated?.toISOString(), new Date(1792100000 * 1000).toISOString());
  });

  it('refuses anything else, saying how to get an export', () => {
    for (const input of [
      'not json',
      '{}',
      '{"addon":"Other"}',
      JSON.stringify({ addon: 'GuildAssistantProfessions' }),
    ]) {
      assert.throws(() => parseProfessionExport(input), /\/ga-prof status/);
    }
    const badIds = {
      addon: 'GuildAssistantProfessions',
      characters: [
        { name: 'Luna', realm: 'X', professions: [{ name: 'Tailoring', spells: ['1'] }] },
      ],
    };
    assert.throws(() => parseProfessionExport(JSON.stringify(badIds)), /bad recipes/);
  });
});

describe('matchCharacter', () => {
  const own = [
    { id: 'a', firstName: 'Luna', lastName: 'Starfall', realm: 'Test Realm' },
    { id: 'b', firstName: 'Bob', lastName: '', realm: 'Test Realm' },
    { id: 'c', firstName: 'Bob', lastName: '', realm: 'Living Flame' },
  ];

  it('matches by first name, or first and last name, ignoring case and accents', () => {
    assert.equal(matchCharacter({ name: 'lúna', realm: 'Anything' }, own)?.id, 'a');
    assert.equal(matchCharacter({ name: 'Luna-Starfall', realm: 'Anything' }, own)?.id, 'a');
    assert.equal(nameKey('Dark-Shivan'), 'darkshivan');
  });

  it('uses the realm on a tie, and gives up when it is still unclear', () => {
    assert.equal(matchCharacter({ name: 'Bob', realm: 'Living Flame' }, own)?.id, 'c');
    assert.equal(matchCharacter({ name: 'Bob', realm: 'Somewhere' }, own), null);
    assert.equal(matchCharacter({ name: 'Nobody', realm: 'Test Realm' }, own), null);
  });
});

describe('wowheadUrl', () => {
  it('links like Wowhead, with the game version in the address', () => {
    assert.equal(
      wowheadUrl('forever', 'spell', 20034, 'Enchant Weapon - Crusader'),
      'https://www.wowhead.com/forever/spell=20034/enchant-weapon-crusader',
    );
    assert.equal(
      wowheadUrl('forever', 'item', 14146, null),
      'https://www.wowhead.com/forever/item=14146',
    );
  });
});

describe('parseSources', () => {
  const SOURCES_FIXTURE = readFileSync(
    join(__dirname, '../../../../addons/dev/GuildAssistantProfessions/export-sources.fixture.json'),
    'utf8',
  );

  it('reads what the addon exports of how recipes are obtained (its test writes the same file)', () => {
    assert.deepEqual(parseProfessionExport(SOURCES_FIXTURE).sources, {
      items: [
        { id: 2881, entries: ['D:Westfall=Defias Renegade Mage', 'O:Westfall='] },
        { id: 6047, entries: ['V:Tanaris=Krinkle Goodsteel'] },
      ],
      trainers: [
        { recipe: 'item:2852', cost: 50, entries: ['Stormwind City=Grimand Elmore'] },
        {
          recipe: 'name:enchant bracer - minor health',
          cost: 10,
          entries: ['Stormwind City=Lucan Cordell'],
        },
      ],
    });
    assert.equal(parseProfessionExport(FIXTURE).sources, null, 'an export without any');
  });

  it("leaves out what isn't a source, without failing the import", () => {
    assert.deepEqual(
      parseSources({
        items: [
          {
            id: 6047,
            entries: ['V:Tanaris=Krinkle', 'nonsense', 'X:Zone=Who', 42, 'V440=By area id'],
          },
          { id: -1, entries: ['V=Nobody'] },
          { id: 7, entries: [`V=${'x'.repeat(100)}`] },
        ],
        trainers: [
          { recipe: 'spell:1', cost: 5, entries: ['Zone=Trainer'] },
          { recipe: 'item:2852', cost: 'free', entries: ['=Grimand', 'no equals'] },
        ],
      }),
      {
        items: [{ id: 6047, entries: ['V:Tanaris=Krinkle', 'V440=By area id'] }],
        trainers: [{ recipe: 'item:2852', cost: null, entries: ['=Grimand'] }],
      },
    );
    assert.equal(parseSources('nonsense'), null);
    assert.equal(parseSources({ items: [], trainers: [] }), null);
  });

  it('takes at most 12 places per item and 2,000 in all', () => {
    const many = Array.from({ length: 30 }, (_, i) => `V:Zone ${i}=Vendor`);
    const items = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, entries: many }));
    const parsed = parseSources({ items })!;
    assert.equal(parsed.items[0].entries.length, 12);
    assert.equal(
      parsed.items.reduce((n, item) => n + item.entries.length, 0),
      2000,
    );
  });
});
