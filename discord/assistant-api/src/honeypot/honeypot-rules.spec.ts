import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BAN_DELETE_SECONDS, decideHoneypot, type HoneypotAuthor } from './honeypot-rules';

const stranger: HoneypotAuthor = {
  userId: 'u',
  botUserId: 'bot',
  isBot: false,
  isServerOwner: false,
  isAdministrator: false,
  mainServerRoleIds: ['member'],
};
const OFFICER = 'officer-role';

describe('decideHoneypot', () => {
  it('bans an ordinary member (live) or would ban them (test mode)', () => {
    assert.deepEqual(decideHoneypot(stranger, OFFICER, false), { action: 'BAN' });
    assert.deepEqual(decideHoneypot(stranger, OFFICER, true), { action: 'WOULD_BAN' });
  });

  it('never touches the bot itself, in either mode', () => {
    const self = { ...stranger, userId: 'bot', isBot: true };
    assert.equal(decideHoneypot(self, OFFICER, false).action, 'IGNORE');
    assert.equal(decideHoneypot(self, OFFICER, true).action, 'IGNORE');
  });

  it('never touches other bots', () => {
    assert.equal(decideHoneypot({ ...stranger, isBot: true }, OFFICER, false).action, 'IGNORE');
  });

  it('exempts Officers, even when they hold other roles too', () => {
    const officer = { ...stranger, mainServerRoleIds: ['member', OFFICER] };
    assert.equal(decideHoneypot(officer, OFFICER, false).action, 'EXEMPT');
  });

  it('exempts the server owner and Administrators', () => {
    assert.equal(
      decideHoneypot({ ...stranger, isServerOwner: true }, OFFICER, false).action,
      'EXEMPT',
    );
    assert.equal(
      decideHoneypot({ ...stranger, isAdministrator: true }, OFFICER, false).action,
      'EXEMPT',
    );
  });

  it('does not exempt anyone as an Officer when the guild has no Officer role', () => {
    const roles = { ...stranger, mainServerRoleIds: [OFFICER] };
    assert.equal(decideHoneypot(roles, null, false).action, 'BAN');
  });

  it('deletes the last hour of messages with the ban', () => {
    assert.equal(BAN_DELETE_SECONDS, 3600);
  });
});
