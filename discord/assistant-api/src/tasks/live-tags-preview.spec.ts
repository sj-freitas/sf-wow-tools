import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveTagsData, previewLiveTags, ROSTER_SAMPLE_SIZE } from './live-tags-preview';
import type { ShowRosterEntry } from './show-sandbox';

const ana = { id: '1', tag: '<@1>', name: 'Ana', displayName: 'Ana', roles: ['Staff', 'Raider'] };
const bo = { id: '2', tag: '<@2>', name: 'Bo', displayName: 'Bo', roles: ['Staff'] };
const cid = { id: '3', tag: '<@3>', name: 'Cid', displayName: 'Cid', roles: ['Raider'] };

const character = (
  name: string,
  attributes: string[],
  cls: string,
  discordUser: ShowRosterEntry['discordUser'],
): ShowRosterEntry => ({
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ')[1] ?? '',
  attributes,
  class: cls,
  race: 'Human',
  roles: ['Tank'],
  level: 60,
  classIcon: '',
  roleIcons: [],
  armoryLink: null,
  discordUser,
});

/** As the roster arrives: every character of the guild, sorted by name. */
const roster: ShowRosterEntry[] = [
  character('Anabank', [], 'Mage', ana),
  character('Bodruid', ['Main'], 'Druid', bo),
  character('Cidalt', ['Alt'], 'Rogue', cid),
  character('Cidmain', ['Main'], 'Hunter', cid),
  character('Merric Stone', ['Main', 'Switcher'], 'Warrior', ana),
  character('Zilly', [], 'Priest', cid),
];

describe('liveTagsData gives the editor the names a tag can match', () => {
  it('counts the whole roster but only shows the first few characters', () => {
    const data = liveTagsData(roster);
    assert.equal(data.rosterCount, 6);
    assert.equal(data.roster.length, ROSTER_SAMPLE_SIZE);
    assert.equal(data.roster[0].name, 'Anabank');
  });

  it('lists the guild attributes and Discord roles in use, each once, A–Z', () => {
    const data = liveTagsData(roster);
    assert.deepEqual(data.attributes, ['Alt', 'Main', 'Switcher']);
    assert.deepEqual(data.discordRoles, ['Raider', 'Staff']);
  });

  it('has nothing to list for a guild whose roster is empty', () => {
    const data = liveTagsData([]);
    assert.deepEqual(data.roster, []);
    assert.equal(data.rosterCount, 0);
    assert.deepEqual(data.attributes, []);
    assert.deepEqual(data.discordRoles, []);
  });

  it('hands over the made-up people a reactions preview uses', () => {
    const { sampleReactions } = liveTagsData(roster);
    assert.equal(sampleReactions.length, 6);
    // The one with no characters at all: what naive expressions trip over.
    assert.deepEqual(
      sampleReactions.find((person) => person.characters.length === 0)?.name,
      'Bruno',
    );
    // A main and an alt, so a per-person expression has something to choose from.
    assert.equal(sampleReactions[0].characters.length, 2);
  });
});

describe('previewLiveTags fills a roster tag in from the guild itself', () => {
  it('writes one line per officer, with the character they marked as their main', async () => {
    const content =
      "Officers:\n{{roster show=\"roster.filter(c => c.discordUser.roles.includes('Staff') && c.attributes.includes('Main')).map(c => ` - ${c.discordUser.tag} — ${c.name}`).join('\\n')\"}}";
    const preview = await previewLiveTags(content, roster);
    assert.equal(preview.error, null);
    assert.equal(preview.text, 'Officers:\n - <@2> — Bodruid\n - <@1> — Merric Stone');
    assert.equal(preview.usedRoster, true);
    assert.equal(preview.usedSampleReactions, false);
  });

  it('counts the guild attributes as the post would', async () => {
    const preview = await previewLiveTags(
      '{{roster show="roster.filter(c => c.attributes.includes(\'Main\')).length"}} mains',
      roster,
    );
    assert.equal(preview.text, '3 mains');
  });

  it('leaves an expression that fails inside the text, as the post shows it', async () => {
    const preview = await previewLiveTags('{{roster show="roster.map(c => c.nope.x)"}}', roster);
    assert.equal(preview.error, null);
    assert.match(preview.text ?? '', /TypeError/);
    assert.equal(preview.usedRoster, true);
  });
});

describe('previewLiveTags fills a reactions tag in from made-up people', () => {
  it('never reads Discord, so a post that was never sent still previews', async () => {
    const preview = await previewLiveTags(
      '{{reactions sourcePost="A post that does not exist" emoji=👍 show="reactions.length"}} signed up',
      roster,
    );
    assert.equal(preview.text, '6 signed up');
    assert.equal(preview.usedSampleReactions, true);
    assert.equal(preview.usedRoster, false);
  });

  it('lists their names when the tag says nothing else', async () => {
    const preview = await previewLiveTags('{{reactions emoji=👍}}', roster);
    assert.equal(preview.text, 'Ana, Bruno, Cora, Dilip, Eve, Faruk');
  });

  it('runs the documented example about mains, including the person with no character', async () => {
    const preview = await previewLiveTags(
      '{{reactions emoji=👍 show="reactions.map(r => (r.characters.find(c => c.attributes.includes(\'Main\')) || r).name)"}}',
      roster,
    );
    assert.equal(
      preview.text,
      'Merric Stone, Bruno, Coraleaf Whisperwind, Dilipstab, Evecaster, Farukshield',
    );
  });

  it('fills both kinds of tag in one text', async () => {
    const preview = await previewLiveTags(
      '{{reactions emoji=👍 show="reactions.length"}} of {{roster show="roster.length"}}',
      roster,
    );
    assert.equal(preview.text, '6 of 6');
    assert.equal(preview.usedSampleReactions, true);
    assert.equal(preview.usedRoster, true);
  });
});

describe('previewLiveTags says what is wrong instead of rendering', () => {
  it('refuses a tag that is written wrongly, in the words saving would use', async () => {
    const preview = await previewLiveTags('{{reactions show="reactions.length"}}', roster);
    assert.equal(preview.text, null);
    assert.match(preview.error ?? '', /needs an emoji/);
    assert.equal(preview.usedRoster, false);
  });

  it('refuses a tag that is never closed', async () => {
    const preview = await previewLiveTags('{{roster show="roster.length"', roster);
    assert.equal(preview.text, null);
    assert.match(preview.error ?? '', /closing \}\}/);
  });

  it('refuses a text longer than a message can be', async () => {
    await assert.rejects(previewLiveTags('x'.repeat(2501), roster), /at most 2000 characters/);
  });

  it('gives a text without tags back as it is', async () => {
    const preview = await previewLiveTags('Nothing dynamic here.', roster);
    assert.equal(preview.text, 'Nothing dynamic here.');
    assert.equal(preview.usedSampleReactions, false);
    assert.equal(preview.usedRoster, false);
  });
});
