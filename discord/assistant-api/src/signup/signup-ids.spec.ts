import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PREFIX,
  compactId,
  customId,
  expandId,
  parseCustomId,
  roleCode,
  statusCode,
} from './signup-ids';

const EVENT = '0b6f3c2e-5d4a-4f1b-9c8d-7e6f5a4b3c2d';
const CHARACTER = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';

describe('sign-up custom ids', () => {
  it('round-trips uuids through their compact form', () => {
    assert.equal(compactId(EVENT).length, 32);
    assert.equal(expandId(compactId(EVENT)), EVENT);
    assert.equal(expandId('not-hex'), null);
  });

  it('fits the longest id (the note form) within Discord’s 100 characters', () => {
    const id = customId(
      PREFIX.note,
      compactId(EVENT),
      statusCode('TENTATIVE'),
      compactId(CHARACTER),
      roleCode('RANGED_DPS'),
    );
    assert.ok(id.length <= 100, `${id.length} characters`);
    assert.deepEqual(parseCustomId(id), {
      eventId: EVENT,
      status: 'TENTATIVE',
      characterId: CHARACTER,
      role: 'RANGED_DPS',
    });
  });

  it('reads ids with fewer parts, and refuses bad ones', () => {
    assert.deepEqual(parseCustomId(customId(PREFIX.join, compactId(EVENT))), {
      eventId: EVENT,
      status: null,
      characterId: null,
      role: null,
    });
    assert.deepEqual(
      parseCustomId(customId(PREFIX.pick, compactId(EVENT), 'A', roleCode('TANK'))),
      {
        eventId: EVENT,
        status: 'AVAILABLE',
        characterId: null,
        role: 'TANK',
      },
    );
    assert.equal(parseCustomId(`${PREFIX.pick}:${compactId(EVENT)}:Q`), null);
    assert.equal(parseCustomId(`${PREFIX.pick}:${compactId(EVENT)}:A:Z`), null);
    assert.equal(parseCustomId(`${PREFIX.join}:nope`), null);
    assert.equal(parseCustomId(undefined), null);
  });
});
