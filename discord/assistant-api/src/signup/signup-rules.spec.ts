import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canCreateEvents,
  canManageEvent,
  canOrganizeEvent,
  canPostIn,
  isClosed,
  validatePlacements,
  type SignupViewer,
} from './signup-rules';

const NOW = new Date('2026-10-20T18:00:00Z');
const later = new Date('2026-10-21T18:00:00Z');
const earlier = new Date('2026-10-19T18:00:00Z');

const member: SignupViewer = { discordId: 'm', isOfficer: false, isEventCreator: false };
const creator: SignupViewer = { discordId: 'c', isOfficer: false, isEventCreator: true };
const officer: SignupViewer = { discordId: 'o', isOfficer: true, isEventCreator: true };

describe('isClosed', () => {
  it('AUTO closes once the event has started', () => {
    assert.equal(isClosed({ lockMode: 'AUTO', startsAt: later }, NOW), false);
    assert.equal(isClosed({ lockMode: 'AUTO', startsAt: earlier }, NOW), true);
    assert.equal(isClosed({ lockMode: 'AUTO', startsAt: NOW }, NOW), true);
  });

  it('an archived event is closed, even when unlocked', () => {
    assert.equal(isClosed({ lockMode: 'UNLOCKED', startsAt: later, archivedAt: NOW }, NOW), true);
    assert.equal(isClosed({ lockMode: 'UNLOCKED', startsAt: later, archivedAt: null }, NOW), false);
  });

  it('LOCKED and UNLOCKED ignore the time', () => {
    assert.equal(isClosed({ lockMode: 'LOCKED', startsAt: later }, NOW), true);
    assert.equal(isClosed({ lockMode: 'UNLOCKED', startsAt: earlier }, NOW), false);
  });
});

describe('permissions', () => {
  const event = { createdByDiscordId: 'c' };
  const othersEvent = { createdByDiscordId: 'someone-else' };

  it('lets Officers and EventCreators create events', () => {
    assert.equal(canCreateEvents(member), false);
    assert.equal(canCreateEvents(creator), true);
    assert.equal(canCreateEvents(officer), true);
  });

  it('lets the owner and Officers manage an event', () => {
    assert.equal(canManageEvent(creator, event), true);
    assert.equal(canManageEvent(creator, othersEvent), false);
    assert.equal(canManageEvent(officer, othersEvent), true);
    assert.equal(canManageEvent(member, othersEvent), false);
  });

  it('lets every EventCreator organise any event, members none', () => {
    assert.equal(canOrganizeEvent(creator, othersEvent), true);
    assert.equal(canOrganizeEvent(member, othersEvent), false);
  });

  it('keeps EventCreators to the event channel', () => {
    assert.equal(canPostIn(creator, 'events', 'events'), true);
    assert.equal(canPostIn(creator, 'events', 'general'), false);
    assert.equal(canPostIn(creator, null, 'general'), false);
    assert.equal(canPostIn(officer, 'events', 'general'), true);
  });
});

describe('validatePlacements', () => {
  const entries = [
    { id: 'a', status: 'AVAILABLE' as const },
    { id: 'b', status: 'LATE' as const },
    { id: 'x', status: 'ABSENT' as const },
  ];

  it('accepts groups, places and the bench', () => {
    assert.equal(
      validatePlacements(
        [
          { entryId: 'a', group: 1, slot: 0 },
          { entryId: 'b', group: 8, slot: 4 },
          { entryId: 'x', group: null, slot: null },
        ],
        entries,
      ),
      null,
    );
  });

  it('refuses unknown people, duplicates, taken places and impossible groups', () => {
    assert.match(validatePlacements([{ entryId: 'z', group: 1, slot: 0 }], entries)!, /no longer/);
    assert.match(
      validatePlacements(
        [
          { entryId: 'a', group: 1, slot: 0 },
          { entryId: 'a', group: 2, slot: 0 },
        ],
        entries,
      )!,
      /twice/,
    );
    assert.match(
      validatePlacements(
        [
          { entryId: 'a', group: 1, slot: 0 },
          { entryId: 'b', group: 1, slot: 0 },
        ],
        entries,
      )!,
      /same place/,
    );
    assert.match(validatePlacements([{ entryId: 'a', group: 9, slot: 0 }], entries)!, /1 to 8/);
    assert.match(validatePlacements([{ entryId: 'a', group: 1, slot: 5 }], entries)!, /5 places/);
  });

  it('keeps absent people out of groups', () => {
    assert.match(validatePlacements([{ entryId: 'x', group: 1, slot: 0 }], entries)!, /absent/);
  });
});
