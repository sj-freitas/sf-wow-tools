import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  MAX_POST_LENGTH,
  messageUrl,
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
