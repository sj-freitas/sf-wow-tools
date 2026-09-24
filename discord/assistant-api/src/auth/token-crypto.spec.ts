import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TokenCrypto } from './token-crypto';

describe('TokenCrypto', () => {
  const crypto = new TokenCrypto('a-secret');

  it('round-trips a token', () => {
    assert.equal(crypto.decrypt(crypto.encrypt('discord-token')), 'discord-token');
  });

  it('produces different ciphertext each time', () => {
    assert.notEqual(crypto.encrypt('same'), crypto.encrypt('same'));
  });

  it('does not contain the plaintext', () => {
    assert.ok(!Buffer.from(crypto.encrypt('discord-token'), 'base64').includes('discord-token'));
  });

  it('rejects tampered ciphertext', () => {
    const raw = Buffer.from(crypto.encrypt('discord-token'), 'base64');
    raw[raw.length - 1] ^= 1;
    assert.throws(() => crypto.decrypt(raw.toString('base64')));
  });

  it('cannot be decrypted with another key', () => {
    assert.throws(() => new TokenCrypto('other-secret').decrypt(crypto.encrypt('discord-token')));
  });
});
