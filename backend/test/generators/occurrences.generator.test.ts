import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  atTimeOfDay,
  clampDayToMonth,
  nextOccurrence,
  runsInMonth,
  runsOnDay,
  runsOnWeekday,
  sortedTimes,
  toMinutesOfDay,
} from '../../src/generators/occurrences.generator.js';
import {
  aDailyConfig, aMonthlyConfig, aWeeklyConfig, hourlyBetween, timeOfDay,
} from '../support/tasks.js';
import { inYerevan, utc } from '../support/time.js';

/**
 * Every schedule now answers the same two questions — which days, and at what
 * times on them — so there is one search to test rather than three. The daily
 * window (09:00 to 23:00 every 2h) is now just the list it expands to.
 */
const water = aDailyConfig('water', { timesOfDay: hourlyBetween('09:00', '23:00', '02:00') });

/** The times a config would fire at, as clock strings, for readable assertions. */
const clocks = (times: { hour: number; minute: number }[]): string[] =>
  times.map(({ hour, minute }) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);

describe('time conversions', () => {
  it('turns a time of day into minutes', () => {
    assert.equal(toMinutesOfDay({ hour: 9, minute: 30 }), 570);
  });

  it('places a time on a given UTC day', () => {
    assert.deepEqual(atTimeOfDay(utc('2026-08-19 23:30'), { hour: 9, minute: 0 }), utc('2026-08-19 09:00'));
  });
});

describe('the times a config fires at', () => {
  it('reads them in the order they happen, whatever order they were stored in', () => {
    const jumbled = aDailyConfig('water', {
      timesOfDay: [timeOfDay('21:00'), timeOfDay('09:00'), timeOfDay('13:00')],
    });

    assert.deepEqual(clocks(sortedTimes(jumbled)), ['09:00', '13:00', '21:00']);
  });

  it('drops a repeated time rather than generating it twice', () => {
    const doubled = aDailyConfig('water', {
      timesOfDay: [timeOfDay('09:00'), timeOfDay('09:00'), timeOfDay('11:00')],
    });

    assert.deepEqual(clocks(sortedTimes(doubled)), ['09:00', '11:00']);
  });

  it('expands a window into the list the form would send', () => {
    assert.deepEqual(
      clocks(water.timesOfDay),
      ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00'],
    );
  });
});

describe('daily — next occurrence', () => {
  it('is 13:00 at 11:45', () => {
    assert.deepEqual(nextOccurrence(water, utc('2026-08-19 11:45')), utc('2026-08-19 13:00'));
  });

  it('is 15:00 at 13:01 — the next listed time, not one hour later', () => {
    assert.deepEqual(nextOccurrence(water, utc('2026-08-19 13:01')), utc('2026-08-19 15:00'));
  });

  it('rolls to tomorrow 09:00 once the last time has gone by', () => {
    assert.deepEqual(nextOccurrence(water, utc('2026-08-19 23:01')), utc('2026-08-20 09:00'));
  });

  it('starts today at 09:00 when asked before the first time', () => {
    assert.deepEqual(nextOccurrence(water, utc('2026-08-19 06:00')), utc('2026-08-19 09:00'));
  });

  it('lands exactly on the last time rather than skipping it', () => {
    assert.deepEqual(nextOccurrence(water, utc('2026-08-19 21:30')), utc('2026-08-19 23:00'));
  });
});

describe('a config with no times cannot generate', () => {
  it('returns null rather than searching for ever', () => {
    const never = aDailyConfig('water', { timesOfDay: [] });

    assert.equal(nextOccurrence(never, utc('2026-08-19 11:45')), null);
  });

  it('returns null when it runs on no days either', () => {
    const nowhere = aDailyConfig('water', { timesOfDay: [timeOfDay('09:00')], weekdays: [] });

    assert.equal(nextOccurrence(nowhere, utc('2026-08-19 11:45')), null);
  });
});

describe('daily — only on the days it runs on', () => {
  // "Daily" defaults to all seven days; deselecting some is how a routine
  // becomes Monday-to-Friday without giving up the several-times-a-day list.
  const onWeekdays = aDailyConfig('water', {
    timesOfDay: hourlyBetween('09:00', '23:00', '02:00'), weekdays: [1, 2, 3, 4, 5],
  });

  it('follows the list on a day it runs on', () => {
    assert.deepEqual(
      nextOccurrence(onWeekdays, utc('Wed 2026-08-19 11:45')),
      utc('Wed 2026-08-19 13:00'),
    );
  });

  it('skips Saturday and Sunday entirely', () => {
    assert.deepEqual(
      nextOccurrence(onWeekdays, utc('Fri 2026-08-21 23:01')),
      utc('Mon 2026-08-24 09:00'),
    );
  });

  it('answers Monday when asked in the middle of a Sunday', () => {
    assert.deepEqual(
      nextOccurrence(onWeekdays, utc('Sun 2026-08-23 12:00')),
      utc('Mon 2026-08-24 09:00'),
    );
  });
});

describe('daily — the edges of a weekday-only config', () => {
  it('finds the one day it runs on, a week out', () => {
    const sundaysOnly = aDailyConfig('water', {
      timesOfDay: hourlyBetween('09:00', '23:00', '02:00'), weekdays: [0],
    });

    assert.deepEqual(
      nextOccurrence(sundaysOnly, utc('Mon 2026-08-24 09:00')),
      utc('Sun 2026-08-30 09:00'),
    );
  });

  it('defaults to every day, so an unchanged config still rolls to tomorrow', () => {
    assert.deepEqual(nextOccurrence(water, utc('Sat 2026-08-22 23:01')), utc('Sun 2026-08-23 09:00'));
  });
});

describe('weekly — next occurrence', () => {
  const gym = aWeeklyConfig('gym', [1, 5]);

  it('knows which weekdays it runs on', () => {
    assert.equal(runsOnWeekday(gym.weekdays, utc('Mon 2026-08-24')), true);
    assert.equal(runsOnWeekday(gym.weekdays, utc('Wed 2026-08-19')), false);
  });

  it('finds Friday from Tuesday', () => {
    assert.deepEqual(nextOccurrence(gym, utc('Tue 2026-08-18 09:00')), utc('Fri 2026-08-21 02:00'));
  });

  it('finds next Monday from Saturday', () => {
    assert.deepEqual(nextOccurrence(gym, utc('Sat 2026-08-22 10:00')), utc('Mon 2026-08-24 02:00'));
  });

  it('still answers today when today is a run day and the time is ahead', () => {
    assert.deepEqual(nextOccurrence(gym, utc('Mon 2026-08-24 01:00')), utc('Mon 2026-08-24 02:00'));
  });

  it('moves to the next run day once today\'s time has gone by', () => {
    assert.deepEqual(nextOccurrence(gym, utc('Mon 2026-08-24 10:00')), utc('Fri 2026-08-28 02:00'));
  });
});

describe('weekly — a time of its own', () => {
  // The hour used to be a constant every weekly config shared. Now it is a
  // field, so a Monday session can be set for the evening.
  it('fires at the time the config names, not a fixed hour', () => {
    const evening = aWeeklyConfig('gym', [1], { timesOfDay: [timeOfDay('15:00')] });

    assert.deepEqual(nextOccurrence(evening, utc('Sat 2026-08-22 10:00')), utc('Mon 2026-08-24 15:00'));
  });

  it('takes several times on one day, which a weekly config could not do before', () => {
    const twice = aWeeklyConfig('gym', [1], {
      timesOfDay: [timeOfDay('07:00'), timeOfDay('18:00')],
    });

    assert.deepEqual(nextOccurrence(twice, utc('Mon 2026-08-24 09:00')), utc('Mon 2026-08-24 18:00'));
  });

  it('rolls to the next run day once both are spent', () => {
    const twice = aWeeklyConfig('gym', [1], {
      timesOfDay: [timeOfDay('07:00'), timeOfDay('18:00')],
    });

    assert.deepEqual(nextOccurrence(twice, utc('Mon 2026-08-24 19:00')), utc('Mon 2026-08-31 07:00'));
  });
});

describe('weekly — the hour it lands on, read locally', () => {
  const gym = aWeeklyConfig('gym', [1, 5]);

  it('lands at 06:00 in Yerevan, which is the point of the default hour', () => {
    const next = nextOccurrence(gym, utc('Sat 2026-08-22 10:00'));

    assert.ok(next !== null);
    assert.equal(inYerevan(next), 'Mon 24 Aug, 06:00');
  });

  it('keeps the occurrence on the weekday asked for once read locally (B1)', () => {
    // The UTC hour is small enough that a reader could reasonably worry the +4
    // offset tips Monday's session into Sunday night. It does not, and this is
    // the guard that would notice if the hour were ever set below the offset.
    const next = nextOccurrence(gym, utc('Sat 2026-08-22 10:00'));

    assert.ok(next !== null);
    assert.ok(inYerevan(next).startsWith('Mon'), `landed on ${inYerevan(next)}`);
  });
});

describe('monthly — next occurrence', () => {
  const rent = aMonthlyConfig('rent', { fromDay: 1, months: [1, 2, 3] });

  it('knows which months it runs in', () => {
    assert.equal(runsInMonth(rent, utc('2026-02-01')), true);
    assert.equal(runsInMonth(rent, utc('2026-08-01')), false);
  });

  it('skips ahead to the next listed month', () => {
    assert.deepEqual(nextOccurrence(rent, utc('2026-08-19 12:00')), utc('2027-01-01 02:00'));
  });

  it('takes this month when its day is still ahead', () => {
    assert.deepEqual(nextOccurrence(rent, utc('2026-02-01 01:00')), utc('2026-02-01 02:00'));
  });

  it('moves on once this month\'s day has gone by', () => {
    assert.deepEqual(nextOccurrence(rent, utc('2026-02-01 10:00')), utc('2026-03-01 02:00'));
  });

  it('generates only on fromDay (Q4)', () => {
    const wide = aMonthlyConfig('rent', { fromDay: 1, months: [2] });

    assert.deepEqual(nextOccurrence(wide, utc('2026-01-15')), utc('2026-02-01 02:00'));
  });
});

describe('monthly — a time of its own', () => {
  it('fires at the time the config names', () => {
    const noon = aMonthlyConfig('rent', {
      fromDay: 1, months: [2], timesOfDay: [timeOfDay('12:00')],
    });

    assert.deepEqual(nextOccurrence(noon, utc('2026-01-15')), utc('2026-02-01 12:00'));
  });

  it('picks out only the chosen day of the month', () => {
    const fifth = aMonthlyConfig('rent', { fromDay: 5, months: [2] });

    assert.equal(runsOnDay(fifth, utc('2026-02-05')), true);
    assert.equal(runsOnDay(fifth, utc('2026-02-06')), false);
  });
});

describe('monthly — short months (B13)', () => {
  it('clamps day 31 to the end of a 30-day month', () => {
    assert.equal(clampDayToMonth(2026, 3, 31), 30);
  });

  it('clamps day 31 to 28 in a non-leap February', () => {
    const late = aMonthlyConfig('rent', { fromDay: 31, months: [2] });

    assert.deepEqual(nextOccurrence(late, utc('2026-01-15')), utc('2026-02-28 02:00'));
  });

  it('reaches 29 February in a leap year', () => {
    const late = aMonthlyConfig('rent', { fromDay: 31, months: [2] });

    assert.deepEqual(nextOccurrence(late, utc('2028-01-15')), utc('2028-02-29 02:00'));
  });
});

describe('nextOccurrence over every schedule', () => {
  it('routes a daily config', () => {
    assert.deepEqual(nextOccurrence(water, utc('2026-08-19 11:45')), utc('2026-08-19 13:00'));
  });

  it('routes a monthly config', () => {
    assert.deepEqual(
      nextOccurrence(aMonthlyConfig('rent', { fromDay: 1, months: [9] }), utc('2026-08-19')),
      utc('2026-09-01 02:00'),
    );
  });

  it('always lands strictly after the instant it was asked about', () => {
    const asked = utc('2026-08-19 13:00');
    const next = nextOccurrence(water, asked);

    assert.ok(next !== null);
    assert.equal(next > asked, true);
  });
});
