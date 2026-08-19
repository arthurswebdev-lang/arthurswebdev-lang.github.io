import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  atTimeOfDay,
  clampDayToMonth,
  dailyGridFor,
  GENERATED_EVENT_TIME,
  isDailyConfigUsable,
  nextDailyOccurrence,
  nextMonthlyOccurrence,
  nextOccurrence,
  nextWeeklyOccurrence,
  runsInMonth,
  runsOnWeekday,
  toMinutesOfDay,
} from '../../src/generators/occurrences.generator.js';
import { aDailyConfig, aMonthlyConfig, aWeeklyConfig } from '../support/tasks.js';
import { utc } from '../support/time.js';

/** "drink water", 09:00 to 23:00 every 2h — the config from the spec. */
const water = aDailyConfig('water', { startsAt: '09:00', endsAt: '23:00', repeatEach: '02:00' });

describe('time conversions', () => {
  it('turns a time of day into minutes', () => {
    assert.equal(toMinutesOfDay({ hour: 9, minute: 30 }), 570);
  });

  it('places a time on a given UTC day', () => {
    assert.deepEqual(atTimeOfDay(utc('2026-08-19 23:30'), { hour: 9, minute: 0 }), utc('2026-08-19 09:00'));
  });
});

describe('daily grid', () => {
  it('lays out every point from startsAt to endsAt', () => {
    const points = dailyGridFor(utc('2026-08-19 11:45'), water).map((p) => p.toISOString().slice(11, 16));

    assert.deepEqual(points, ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00']);
  });

  it('stops early when the window does not divide evenly (Q/B11)', () => {
    const everyFour = aDailyConfig('water', { startsAt: '09:00', endsAt: '23:00', repeatEach: '04:00' });
    const points = dailyGridFor(utc('2026-08-19'), everyFour).map((p) => p.toISOString().slice(11, 16));

    assert.deepEqual(points, ['09:00', '13:00', '17:00', '21:00']);
  });
});

describe('daily — next occurrence', () => {
  it('is 13:00 at 11:45', () => {
    assert.deepEqual(nextDailyOccurrence(water, utc('2026-08-19 11:45')), utc('2026-08-19 13:00'));
  });

  it('is 15:00 at 13:01 — the grid, not one hour later', () => {
    assert.deepEqual(nextDailyOccurrence(water, utc('2026-08-19 13:01')), utc('2026-08-19 15:00'));
  });

  it('rolls to tomorrow 09:00 once 23:00 has gone by', () => {
    assert.deepEqual(nextDailyOccurrence(water, utc('2026-08-19 23:01')), utc('2026-08-20 09:00'));
  });

  it('starts today at 09:00 when asked before the window opens', () => {
    assert.deepEqual(nextDailyOccurrence(water, utc('2026-08-19 06:00')), utc('2026-08-19 09:00'));
  });

  it('lands exactly on the last grid point rather than skipping it', () => {
    assert.deepEqual(nextDailyOccurrence(water, utc('2026-08-19 21:30')), utc('2026-08-19 23:00'));
  });
});

describe('daily — configs that cannot generate (B10, B12)', () => {
  it('refuses a zero repeatEach instead of looping for ever', () => {
    const noStep = aDailyConfig('water', { startsAt: '09:00', endsAt: '23:00', repeatEach: '00:00' });

    assert.equal(isDailyConfigUsable(noStep), false);
    assert.equal(nextDailyOccurrence(noStep, utc('2026-08-19 11:45')), null);
  });

  it('refuses a window that ends before it starts', () => {
    const backwards = aDailyConfig('water', { startsAt: '23:00', endsAt: '09:00', repeatEach: '02:00' });

    assert.equal(isDailyConfigUsable(backwards), false);
    assert.equal(nextDailyOccurrence(backwards, utc('2026-08-19 11:45')), null);
  });
});

describe('weekly — next occurrence', () => {
  const gym = aWeeklyConfig('gym', [1, 5]);

  it('knows which weekdays it runs on', () => {
    assert.equal(runsOnWeekday(gym, utc('Mon 2026-08-24')), true);
    assert.equal(runsOnWeekday(gym, utc('Wed 2026-08-19')), false);
  });

  it('finds Friday from Tuesday', () => {
    assert.deepEqual(nextWeeklyOccurrence(gym, utc('Tue 2026-08-18 09:00')), utc('Fri 2026-08-21 09:00'));
  });

  it('finds next Monday from Saturday', () => {
    assert.deepEqual(nextWeeklyOccurrence(gym, utc('Sat 2026-08-22 10:00')), utc('Mon 2026-08-24 09:00'));
  });

  it('still answers today when today is a run day and the time is ahead', () => {
    assert.deepEqual(nextWeeklyOccurrence(gym, utc('Mon 2026-08-24 08:00')), utc('Mon 2026-08-24 09:00'));
  });

  it('moves to the next run day once today\'s time has gone by', () => {
    assert.deepEqual(nextWeeklyOccurrence(gym, utc('Mon 2026-08-24 10:00')), utc('Fri 2026-08-28 09:00'));
  });

  it('generates at 09:00, not midnight (B1)', () => {
    const next = nextWeeklyOccurrence(gym, utc('Sat 2026-08-22 10:00'));

    assert.ok(next !== null);
    assert.equal(next.getUTCHours(), GENERATED_EVENT_TIME.hour);
    assert.notEqual(next.getUTCHours(), 0);
  });
});

describe('monthly — next occurrence', () => {
  const rent = aMonthlyConfig('rent', { fromDay: 1, toDay: 5, months: [1, 2, 3] });

  it('knows which months it runs in', () => {
    assert.equal(runsInMonth(rent, utc('2026-02-01')), true);
    assert.equal(runsInMonth(rent, utc('2026-08-01')), false);
  });

  it('skips ahead to the next listed month', () => {
    assert.deepEqual(nextMonthlyOccurrence(rent, utc('2026-08-19 12:00')), utc('2027-01-01 09:00'));
  });

  it('takes this month when its day is still ahead', () => {
    assert.deepEqual(nextMonthlyOccurrence(rent, utc('2026-02-01 08:00')), utc('2026-02-01 09:00'));
  });

  it('moves on once this month\'s day has gone by', () => {
    assert.deepEqual(nextMonthlyOccurrence(rent, utc('2026-02-01 10:00')), utc('2026-03-01 09:00'));
  });

  it('generates only on fromDay — toDay does not schedule anything (Q4)', () => {
    const wide = aMonthlyConfig('rent', { fromDay: 1, toDay: 28, months: [2] });

    assert.deepEqual(nextMonthlyOccurrence(wide, utc('2026-01-15')), utc('2026-02-01 09:00'));
  });
});

describe('monthly — short months (B13)', () => {
  it('clamps day 31 to the end of a 30-day month', () => {
    assert.equal(clampDayToMonth(2026, 3, 31), 30);
  });

  it('clamps day 31 to 28 in a non-leap February', () => {
    const late = aMonthlyConfig('rent', { fromDay: 31, toDay: 31, months: [2] });

    assert.deepEqual(nextMonthlyOccurrence(late, utc('2026-01-15')), utc('2026-02-28 09:00'));
  });

  it('reaches 29 February in a leap year', () => {
    const late = aMonthlyConfig('rent', { fromDay: 31, toDay: 31, months: [2] });

    assert.deepEqual(nextMonthlyOccurrence(late, utc('2028-01-15')), utc('2028-02-29 09:00'));
  });
});

describe('nextOccurrence dispatches on config type', () => {
  it('routes a daily config', () => {
    assert.deepEqual(nextOccurrence(water, utc('2026-08-19 11:45')), utc('2026-08-19 13:00'));
  });

  it('routes a weekly config', () => {
    assert.deepEqual(
      nextOccurrence(aWeeklyConfig('gym', [1, 5]), utc('Sat 2026-08-22 10:00')),
      utc('Mon 2026-08-24 09:00'),
    );
  });

  it('routes a monthly config', () => {
    assert.deepEqual(
      nextOccurrence(aMonthlyConfig('rent', { fromDay: 1, toDay: 5, months: [9] }), utc('2026-08-19')),
      utc('2026-09-01 09:00'),
    );
  });

  it('always lands strictly after the instant it was asked about', () => {
    const asked = utc('2026-08-19 13:00');
    const next = nextOccurrence(water, asked);

    assert.ok(next !== null);
    assert.equal(next > asked, true);
  });
});
