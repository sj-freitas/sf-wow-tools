import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { discordPostIdOf } from './signup.controller';

describe('discordPostIdOf', () => {
  const ID = '1298765432109876543';

  it('reads a post id, or the message of a Discord link', () => {
    assert.equal(discordPostIdOf(ID), ID);
    assert.equal(discordPostIdOf(` ${ID} `), ID);
    assert.equal(
      discordPostIdOf(`https://discord.com/channels/111111111111111111/222222222222222222/${ID}`),
      ID,
    );
    assert.equal(
      discordPostIdOf(
        `https://ptb.discord.com/channels/111111111111111111/222222222222222222/${ID}`,
      ),
      ID,
    );
    assert.equal(
      discordPostIdOf(
        `https://discordapp.com/channels/111111111111111111/222222222222222222/${ID}/`,
      ),
      ID,
    );
  });

  it('is null for anything else', () => {
    assert.equal(discordPostIdOf(undefined), null);
    assert.equal(discordPostIdOf('Molten Core'), null);
    assert.equal(discordPostIdOf('1234'), null);
    assert.equal(discordPostIdOf(`https://example.com/channels/1/2/${ID}`), null);
  });
});
