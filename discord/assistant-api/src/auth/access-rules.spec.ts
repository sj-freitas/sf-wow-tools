import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canConfigureGuild,
  canEditCharacter,
  canManageAllCharacters,
  holdsRoleNamed,
  isGuildAssistant,
} from './access-rules';

const none = { isAdmin: false, isOfficer: false };
const admin = { isAdmin: true, isOfficer: false };
const officer = { isAdmin: false, isOfficer: true };

describe('holdsRoleNamed', () => {
  const roles = [
    { id: '1', name: 'Guild-Assistant' },
    { id: '2', name: 'Raider' },
    { id: '3', name: 'Guild-Assistant' },
  ];

  it('is true when the member holds the named role', () => {
    assert.equal(holdsRoleNamed(roles, ['2', '1'], 'Guild-Assistant'), true);
  });

  it('counts any role with the name, not just the first (duplicate names)', () => {
    assert.equal(holdsRoleNamed(roles, ['3'], 'Guild-Assistant'), true);
  });

  it('is false when the member has other roles only', () => {
    assert.equal(holdsRoleNamed(roles, ['2'], 'Guild-Assistant'), false);
  });

  it('is false when the server has no such role', () => {
    assert.equal(holdsRoleNamed([{ id: '2', name: 'Raider' }], ['2'], 'Guild-Assistant'), false);
  });

  it('is case sensitive', () => {
    assert.equal(holdsRoleNamed(roles, ['1'], 'guild-assistant'), false);
  });
});

describe('isGuildAssistant', () => {
  it('needs the role in every server of the guild', () => {
    assert.equal(isGuildAssistant(['a', 'b'], new Set(['a', 'b'])), true);
    assert.equal(isGuildAssistant(['a', 'b'], new Set(['a'])), false);
    assert.equal(isGuildAssistant(['a'], new Set()), false);
  });

  it('ignores roles held in servers that are not part of the guild', () => {
    assert.equal(isGuildAssistant(['a'], new Set(['a', 'z'])), true);
  });
});

describe('permission matrix', () => {
  it('Guild-Assistants and Officers configure the guild, plain members do not', () => {
    assert.equal(canConfigureGuild(admin), true);
    assert.equal(canConfigureGuild(officer), true);
    assert.equal(canConfigureGuild(none), false);
  });

  it('only Officers manage every character', () => {
    assert.equal(canManageAllCharacters(officer), true);
    assert.equal(canManageAllCharacters(admin), false);
    assert.equal(canManageAllCharacters(none), false);
  });

  it('members edit their own characters only', () => {
    assert.equal(canEditCharacter(none, 'me', 'me'), true);
    assert.equal(canEditCharacter(none, 'someone-else', 'me'), false);
  });

  it('a Guild-Assistant who is not an Officer edits only their own characters', () => {
    assert.equal(canEditCharacter(admin, 'me', 'me'), true);
    assert.equal(canEditCharacter(admin, 'someone-else', 'me'), false);
  });

  it('Officers edit anyone’s characters', () => {
    assert.equal(canEditCharacter(officer, 'someone-else', 'me'), true);
  });

  it('people outside the guild edit nothing, not even their own', () => {
    assert.equal(canEditCharacter(null, 'me', 'me'), false);
  });
});
