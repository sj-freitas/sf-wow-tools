import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  nextHalfHourIn,
  parseEventStart,
  parseTimeOfDay,
  resolveTimezone,
  todayIn,
} from './signup-time';

const PARIS = 'Europe/Paris';

describe('todayIn', () => {
  it('is the date in the zone, which may not be the UTC one', () => {
    const lateEvening = new Date('2026-10-20T23:30:00Z');
    assert.equal(todayIn('UTC', lateEvening), '2026-10-20');
    assert.equal(todayIn('Europe/Paris', lateEvening), '2026-10-21');
    assert.equal(todayIn('America/Los_Angeles', lateEvening), '2026-10-20');
  });
});

describe('nextHalfHourIn', () => {
  const at = (iso: string) => nextHalfHourIn('UTC', new Date(iso));

  it('rounds up to the next full or half hour', () => {
    assert.deepEqual(at('2026-10-20T15:15:00Z'), { date: '2026-10-20', time: '15:30' });
    assert.deepEqual(at('2026-10-20T15:31:00Z'), { date: '2026-10-20', time: '16:00' });
    assert.deepEqual(at('2026-10-20T15:00:00Z'), { date: '2026-10-20', time: '15:00' });
    assert.deepEqual(at('2026-10-20T15:30:45Z'), { date: '2026-10-20', time: '15:30' });
  });

  it('is tomorrow late at night, in the zone', () => {
    assert.deepEqual(at('2026-10-20T23:45:00Z'), { date: '2026-10-21', time: '00:00' });
    // 21:50 UTC is 23:50 in Paris (summer time, UTC+2).
    assert.deepEqual(nextHalfHourIn('Europe/Paris', new Date('2026-10-20T21:50:00Z')), {
      date: '2026-10-21',
      time: '00:00',
    });
  });
});

describe('resolveTimezone', () => {
  it('reads nothing and ST as the server time', () => {
    assert.equal(resolveTimezone(undefined, PARIS), PARIS);
    assert.equal(resolveTimezone(' st ', PARIS), PARIS);
  });

  it('accepts IANA names in any casing, in their canonical spelling', () => {
    assert.equal(resolveTimezone('europe/lisbon', PARIS), 'Europe/Lisbon');
  });

  it('accepts UTC and offsets', () => {
    assert.equal(resolveTimezone('utc', PARIS), 'UTC');
    assert.equal(resolveTimezone('+02:00', PARIS), 'UTC+2');
    assert.equal(resolveTimezone('UTC-5', PARIS), 'UTC-5');
    assert.equal(resolveTimezone('+05:30', PARIS), 'UTC+5:30');
  });

  it('refuses what it does not know', () => {
    assert.equal(resolveTimezone('Mars/Olympus', PARIS), null);
    assert.equal(resolveTimezone('+20:00', PARIS), null);
  });
});

describe('parseTimeOfDay', () => {
  it('reads 24-hour and 12-hour times', () => {
    assert.deepEqual(parseTimeOfDay('20:30'), { hour: 20, minute: 30 });
    assert.deepEqual(parseTimeOfDay('8.05'), { hour: 8, minute: 5 });
    assert.deepEqual(parseTimeOfDay('8pm'), { hour: 20, minute: 0 });
    assert.deepEqual(parseTimeOfDay('12:15 am'), { hour: 0, minute: 15 });
  });

  it('refuses impossible times', () => {
    assert.equal(parseTimeOfDay('24:00'), null);
    assert.equal(parseTimeOfDay('13pm'), null);
    assert.equal(parseTimeOfDay('soon'), null);
  });
});

describe('parseEventStart', () => {
  it('reads the time in the zone (Paris is UTC+2 in summer, UTC+1 in winter)', () => {
    assert.equal(
      (parseEventStart('2026-10-20', '20:00', PARIS) as Date).toISOString(),
      '2026-10-20T18:00:00.000Z',
    );
    assert.equal(
      (parseEventStart('2026-11-20', '20:00', PARIS) as Date).toISOString(),
      '2026-11-20T19:00:00.000Z',
    );
  });

  it('explains a bad date, time, or a time skipped by the clocks changing', () => {
    assert.match(parseEventStart('20/10/2026', '20:00', PARIS) as string, /YYYY-MM-DD/);
    assert.match(parseEventStart('2026-02-30', '20:00', PARIS) as string, /not a date/);
    assert.match(parseEventStart('2026-10-20', 'late', PARIS) as string, /HH:mm/);
    assert.match(parseEventStart('2027-03-28', '02:30', PARIS) as string, /does not exist/);
  });
});
