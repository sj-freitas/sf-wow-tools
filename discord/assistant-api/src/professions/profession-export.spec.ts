import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  exportFromSavedVariables,
  matchCharacter,
  nameKey,
  parseProfessionExport,
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
    '\t\t["Luna-Wild Growth"] = {',
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
    assert.equal(data.characters.length, 3);
    assert.deepEqual(data.characters[1].professions[0].spells, [13890, 20034]);
  });

  it("reads the addon's export", () => {
    const data = parseProfessionExport(FIXTURE);
    assert.deepEqual(
      data.characters.map((c) => [c.name, c.source]),
      [
        ['Bob', 'own'],
        ['Luna', 'own'],
        ['Mira', 'link'],
      ],
    );
    const luna = data.characters[1];
    assert.equal(luna.realm, 'Wild Growth');
    assert.deepEqual(luna.professions[0], {
      name: 'Enchanting',
      skill: 300,
      max: 300,
      spells: [13890, 20034],
      items: [],
    });
    assert.deepEqual(luna.professions[1].items, [14146]);
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
    { id: 'a', firstName: 'Luna', lastName: 'Starfall', realm: 'Wild Growth' },
    { id: 'b', firstName: 'Bob', lastName: '', realm: 'Wild Growth' },
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
    assert.equal(matchCharacter({ name: 'Nobody', realm: 'Wild Growth' }, own), null);
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
