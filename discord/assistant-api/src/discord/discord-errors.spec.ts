import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DiscordAPIError } from '@discordjs/rest';
import { describeDiscordError, isDiscordError } from './discord-errors';

const discordError = (code: number, message = 'x') =>
  new DiscordAPIError({ message, code }, code, 403, 'POST', 'https://discord.com/api', {});

describe('describeDiscordError', () => {
  it('explains the common permission and existence errors', () => {
    assert.match(describeDiscordError(discordError(50013)), /missing a permission/);
    assert.match(describeDiscordError(discordError(50001)), /cannot see/);
    assert.match(describeDiscordError(discordError(10003)), /channel no longer exists/);
    assert.match(describeDiscordError(discordError(10008)), /message no longer exists/);
  });

  it('falls back to Discord’s own message for other codes', () => {
    assert.match(describeDiscordError(discordError(99999, 'Something odd')), /Something odd/);
  });

  it('handles rate limits and plain errors', () => {
    assert.match(describeDiscordError(new Error('429 Too Many Requests')), /rate limiting/);
    assert.equal(describeDiscordError(new Error('boom')), 'boom');
    assert.equal(describeDiscordError('text'), 'text');
  });

  it('isDiscordError matches by code', () => {
    assert.equal(isDiscordError(discordError(10008), 10008), true);
    assert.equal(isDiscordError(discordError(10003), 10008), false);
    assert.equal(isDiscordError(new Error('x'), 10008), false);
  });
});
