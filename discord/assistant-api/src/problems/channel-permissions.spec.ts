import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  channelPermissions,
  missingFor,
  PERMISSIONS as P,
  type PermissionInputs,
} from './channel-permissions';

const SERVER = 's1';
const BOT = 'bot';
const inputs = (over: Partial<PermissionInputs> = {}): PermissionInputs => ({
  serverId: SERVER,
  memberId: BOT,
  memberRoleIds: ['botrole'],
  roles: [
    { id: SERVER, permissions: P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY },
    { id: 'botrole', permissions: P.SEND_MESSAGES | P.EMBED_LINKS | P.ADD_REACTIONS },
  ],
  overwrites: [],
  ...over,
});

describe('channelPermissions', () => {
  it("adds up @everyone's and the bot's roles", () => {
    assert.deepEqual(missingFor('post', channelPermissions(inputs())), []);
    assert.deepEqual(missingFor('cleanup', channelPermissions(inputs())), ['MANAGE_MESSAGES']);
  });

  it("applies the channel's overwrites: @everyone, then the roles, then the bot itself", () => {
    // A private channel: @everyone can't see it, the bot's role can.
    const priv = inputs({
      overwrites: [
        { id: SERVER, type: 0, allow: 0n, deny: P.VIEW_CHANNEL },
        { id: 'botrole', type: 0, allow: P.VIEW_CHANNEL, deny: 0n },
      ],
    });
    assert.deepEqual(missingFor('post', channelPermissions(priv)), []);
    // ...but without the role's allow, the bot can't see it.
    const hidden = inputs({
      overwrites: [{ id: SERVER, type: 0, allow: 0n, deny: P.VIEW_CHANNEL }],
    });
    assert.deepEqual(missingFor('post', channelPermissions(hidden)), ['VIEW_CHANNEL']);
    // A member overwrite on the bot beats its roles.
    const muted = inputs({
      overwrites: [{ id: BOT, type: 1, allow: 0n, deny: P.SEND_MESSAGES | P.EMBED_LINKS }],
    });
    assert.deepEqual(missingFor('post', channelPermissions(muted)), [
      'SEND_MESSAGES',
      'EMBED_LINKS',
    ]);
  });

  it('allows everything to an Administrator, whatever the overwrites', () => {
    const admin = inputs({
      roles: [
        { id: SERVER, permissions: 0n },
        { id: 'botrole', permissions: P.ADMINISTRATOR },
      ],
      overwrites: [{ id: BOT, type: 1, allow: 0n, deny: P.SEND_MESSAGES }],
    });
    assert.deepEqual(missingFor('honeypot', channelPermissions(admin)), []);
    assert.deepEqual(missingFor('post', channelPermissions(admin)), []);
  });
});
