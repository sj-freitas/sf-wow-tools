import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  isComplete,
  isLive,
  liveMessageOf,
  MAX_POST_LENGTH,
  messageUrl,
  parseParts,
  wasDeleted,
  normalizeEmoji,
  parsePostContent,
  parseSeedReactions,
  parseSnowflake,
} from './post-task';

describe('normalizeEmoji', () => {
  it('keeps unicode emoji', () => {
    assert.equal(normalizeEmoji('👍'), '👍');
    assert.equal(normalizeEmoji(' ✅ '), '✅');
  });

  it('turns custom emoji syntax into name:id', () => {
    assert.equal(normalizeEmoji('<:pepe:123456789012345678>'), 'pepe:123456789012345678');
    assert.equal(normalizeEmoji('<a:party:123456789012345678>'), 'party:123456789012345678');
  });

  it('accepts name:id as is', () => {
    assert.equal(normalizeEmoji('pepe:123456789012345678'), 'pepe:123456789012345678');
  });

  it('rejects text, mentions and empty input', () => {
    assert.equal(normalizeEmoji('thumbsup'), null);
    assert.equal(normalizeEmoji('<@123456789012345678>'), null);
    assert.equal(normalizeEmoji(':smile:'), null);
    assert.equal(normalizeEmoji('   '), null);
  });
});

describe('post fields', () => {
  it('requires text within Discord’s limit', () => {
    assert.equal(parsePostContent('Raid at **20:00**'), 'Raid at **20:00**');
    assert.throws(() => parsePostContent(''), BadRequestException);
    assert.throws(() => parsePostContent('   '), BadRequestException);
    assert.throws(() => parsePostContent(42), BadRequestException);
    assert.throws(() => parsePostContent('x'.repeat(MAX_POST_LENGTH + 1)), BadRequestException);
    assert.equal(parsePostContent('x'.repeat(MAX_POST_LENGTH)).length, MAX_POST_LENGTH);
  });

  it('parses seed reactions, de-duplicating', () => {
    assert.deepEqual(parseSeedReactions(['👍', '👎', '👍']), ['👍', '👎']);
    assert.deepEqual(parseSeedReactions(undefined), []);
    assert.throws(() => parseSeedReactions(['nope']), BadRequestException);
    assert.throws(() => parseSeedReactions('👍'), BadRequestException);
    assert.throws(() => parseSeedReactions(Array(11).fill('👍')), BadRequestException);
  });

  it('validates snowflakes and builds message links', () => {
    assert.equal(parseSnowflake('123456789012345678', 'x'), '123456789012345678');
    assert.throws(() => parseSnowflake('abc', 'The channel'), BadRequestException);
    assert.equal(messageUrl('1', '2', '3'), 'https://discord.com/channels/1/2/3');
  });
});

describe('the messages of a post', () => {
  const ids = () => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  };
  const posted = (partId: string, deleted = false) => ({
    partId,
    messageId: `m-${partId}`,
    channelId: 'c',
    serverId: 's',
    postedAt: '',
    renderedContent: '',
    imageIds: [],
    embedLinks: true,
    ...(deleted ? { deleted } : {}),
  });

  it('knows which messages are in Discord, and whether the whole post is', () => {
    const config = {
      serverId: 's',
      channelId: 'c',
      parts: parseParts([{ content: 'a' }, { content: 'b' }], ids()),
    };
    const [one, two] = config.parts.map((part) => part.id);
    assert.equal(isLive({}), false);
    assert.equal(isComplete(config, {}), false);
    assert.equal(isLive({ messages: [posted(one)] }), true);
    assert.equal(isComplete(config, { messages: [posted(one)] }), false);
    assert.equal(isComplete(config, { messages: [posted(one), posted(two)] }), true);
    assert.equal(isComplete(config, { messages: [posted(one), posted(two, true)] }), false);
    assert.equal(liveMessageOf({ messages: [posted(one, true)] }, one), undefined);
  });

  it('tells a post that was deleted from one that never went out', () => {
    assert.equal(wasDeleted({}), false);
    assert.equal(wasDeleted({ messages: [posted('p', true)] }), true);
    assert.equal(wasDeleted({ messages: [posted('p')] }), false);
  });

  it('keeps the ids it is given and gives the others a new one', () => {
    const given = '11111111-2222-4333-8444-555555555555';
    const [a, b] = parseParts([{ id: given, content: 'a' }, { content: 'b' }], ids());
    assert.equal(a.id, given);
    assert.match(b.id, /^00000000-/);
    assert.throws(
      () =>
        parseParts(
          [
            { id: given, content: 'a' },
            { id: given, content: 'b' },
          ],
          ids(),
        ),
      /same id/,
    );
  });
});
