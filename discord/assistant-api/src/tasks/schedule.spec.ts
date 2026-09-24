import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeSchedule,
  instantFromLocal,
  nextOccurrence,
  occurrencesBetween,
  validateSchedule,
} from './schedule';

const PARIS = 'Europe/Paris';
const LA = 'America/Los_Angeles';
const iso = (date: Date | null) => date?.toISOString() ?? null;
const at = (value: string) => new Date(value);

describe('nextOccurrence', () => {
  describe('daily', () => {
    const daily = { kind: 'DAILY' as const, timeOfDay: '20:00' };

    it('runs later today when the time has not passed (Paris summer time is UTC+2)', () => {
      assert.equal(
        iso(nextOccurrence(daily, PARIS, at('2026-10-01T10:00:00Z'))),
        '2026-10-01T18:00:00.000Z',
      );
    });

    it('runs tomorrow when the time has passed', () => {
      assert.equal(
        iso(nextOccurrence(daily, PARIS, at('2026-10-01T19:00:00Z'))),
        '2026-10-02T18:00:00.000Z',
      );
    });

    it('is strictly after the given moment', () => {
      assert.equal(
        iso(nextOccurrence(daily, PARIS, at('2026-10-01T18:00:00Z'))),
        '2026-10-02T18:00:00.000Z',
      );
    });

    it('keeps the wall-clock time across the end of daylight saving time', () => {
      // Paris clocks go back on 2026-10-25: 20:00 becomes UTC+1.
      assert.equal(
        iso(nextOccurrence(daily, PARIS, at('2026-10-24T18:00:00Z'))),
        '2026-10-25T19:00:00.000Z',
      );
    });

    it('keeps the wall-clock time across the start of daylight saving time', () => {
      // Paris clocks go forward on 2026-03-29: 20:00 becomes UTC+2.
      assert.equal(
        iso(nextOccurrence(daily, PARIS, at('2026-03-28T19:00:00Z'))),
        '2026-03-29T18:00:00.000Z',
      );
    });

    it('uses the region timezone (US Pacific, winter is UTC-8)', () => {
      const morning = { kind: 'DAILY' as const, timeOfDay: '09:00' };
      assert.equal(
        iso(nextOccurrence(morning, LA, at('2026-12-01T00:00:00Z'))),
        '2026-12-01T17:00:00.000Z',
      );
    });
  });

  describe('weekly', () => {
    const tuesday = { kind: 'WEEKLY' as const, weekday: 2, timeOfDay: '20:00' };

    it('runs on the next matching weekday (2026-10-01 is a Thursday)', () => {
      assert.equal(
        iso(nextOccurrence(tuesday, PARIS, at('2026-10-01T10:00:00Z'))),
        '2026-10-06T18:00:00.000Z',
      );
    });

    it('runs later the same day when it is that weekday and the time has not passed', () => {
      assert.equal(
        iso(nextOccurrence(tuesday, PARIS, at('2026-10-06T10:00:00Z'))),
        '2026-10-06T18:00:00.000Z',
      );
    });

    it('waits a week when that weekday’s time has passed', () => {
      assert.equal(
        iso(nextOccurrence(tuesday, PARIS, at('2026-10-06T19:00:00Z'))),
        '2026-10-13T18:00:00.000Z',
      );
    });

    it('handles Sunday (7)', () => {
      const sunday = { kind: 'WEEKLY' as const, weekday: 7, timeOfDay: '10:00' };
      assert.equal(
        iso(nextOccurrence(sunday, PARIS, at('2026-10-01T10:00:00Z'))),
        '2026-10-04T08:00:00.000Z',
      );
    });
  });

  describe('once', () => {
    const runAt = at('2026-10-05T18:00:00Z');

    it('returns the instant while it is in the future', () => {
      assert.equal(
        iso(nextOccurrence({ kind: 'ONCE', runAt }, PARIS, at('2026-10-01T00:00:00Z'))),
        '2026-10-05T18:00:00.000Z',
      );
    });

    it('returns null once it has passed', () => {
      assert.equal(
        nextOccurrence({ kind: 'ONCE', runAt }, PARIS, at('2026-10-05T18:00:00Z')),
        null,
      );
      assert.equal(
        nextOccurrence({ kind: 'ONCE', runAt }, PARIS, at('2026-11-01T00:00:00Z')),
        null,
      );
    });
  });
});

describe('occurrencesBetween', () => {
  const daily = { kind: 'DAILY' as const, timeOfDay: '20:00' };

  it('lists the occurrences a delayed run skipped, oldest first', () => {
    const skipped = occurrencesBetween(
      daily,
      PARIS,
      at('2026-10-01T18:00:00Z'),
      at('2026-10-04T12:00:00Z'),
    );
    assert.deepEqual(skipped.map(iso), ['2026-10-02T18:00:00.000Z', '2026-10-03T18:00:00.000Z']);
  });

  it('is empty when the run is on time', () => {
    assert.deepEqual(
      occurrencesBetween(daily, PARIS, at('2026-10-01T18:00:00Z'), at('2026-10-01T18:01:00Z')),
      [],
    );
  });

  it('includes an occurrence exactly at the end', () => {
    assert.equal(
      occurrencesBetween(daily, PARIS, at('2026-10-01T18:00:00Z'), at('2026-10-02T18:00:00Z'))
        .length,
      1,
    );
  });

  it('is capped', () => {
    assert.equal(
      occurrencesBetween(daily, PARIS, at('2020-01-01T00:00:00Z'), at('2026-01-01T00:00:00Z'), 5)
        .length,
      5,
    );
  });
});

describe('validateSchedule', () => {
  it('accepts valid schedules', () => {
    assert.deepEqual(validateSchedule({ kind: 'DAILY', timeOfDay: '07:05' }), []);
    assert.deepEqual(validateSchedule({ kind: 'WEEKLY', timeOfDay: '23:59', weekday: 7 }), []);
    assert.deepEqual(validateSchedule({ kind: 'ONCE', runAt: new Date() }), []);
  });

  it('rejects bad times, weekdays and missing dates', () => {
    assert.equal(validateSchedule({ kind: 'DAILY', timeOfDay: '24:00' }).length, 1);
    assert.equal(validateSchedule({ kind: 'DAILY', timeOfDay: '8:00' }).length, 1);
    assert.equal(validateSchedule({ kind: 'DAILY', timeOfDay: null }).length, 1);
    assert.equal(validateSchedule({ kind: 'WEEKLY', timeOfDay: '20:00', weekday: 0 }).length, 1);
    assert.equal(validateSchedule({ kind: 'WEEKLY', timeOfDay: '20:00', weekday: 8 }).length, 1);
    assert.equal(validateSchedule({ kind: 'ONCE', runAt: null }).length, 1);
  });
});

describe('describeSchedule and instantFromLocal', () => {
  it('describes schedules in words', () => {
    assert.equal(
      describeSchedule({ kind: 'DAILY', timeOfDay: '20:00' }, PARIS),
      'Every day at 20:00',
    );
    assert.equal(
      describeSchedule({ kind: 'WEEKLY', weekday: 2, timeOfDay: '20:00' }, PARIS),
      'Every Tuesday at 20:00',
    );
    assert.equal(
      describeSchedule({ kind: 'ONCE', runAt: at('2026-10-05T18:00:00Z') }, PARIS),
      'Once on 2026-10-05 at 20:00',
    );
  });

  it('reads a wall-clock time in the guild timezone', () => {
    assert.equal(iso(instantFromLocal('2026-10-01T20:00', PARIS)), '2026-10-01T18:00:00.000Z');
    assert.equal(iso(instantFromLocal('2026-12-01T09:00', LA)), '2026-12-01T17:00:00.000Z');
  });

  it('returns null for garbage', () => {
    assert.equal(instantFromLocal('not a date', PARIS), null);
  });
});
