import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { scheduleMoved, scheduleOf } from '../../src/rules/repeated-task-schedule.rules.js';
import {
  aDailyConfig, aMonthlyConfig, aWeeklyConfig, hourlyBetween, timeOfDay,
} from '../support/tasks.js';

const gym = aWeeklyConfig('gym', [1, 5]);
const water = aDailyConfig('water', { timesOfDay: hourlyBetween('09:00', '23:00', '02:00') });
const rent = aMonthlyConfig('rent', { fromDay: 5, months: [9, 10] });

describe('what counts as the same schedule', () => {
  it('ignores the order the weekdays were tapped in', () => {
    assert.equal(scheduleMoved(gym, aWeeklyConfig('gym', [5, 1])), false);
  });

  it('ignores the order the months were listed in', () => {
    assert.equal(scheduleMoved(rent, aMonthlyConfig('rent', { fromDay: 5, months: [10, 9] })), false);
  });

  it('sees a different weekday as a move', () => {
    assert.equal(scheduleMoved(gym, aWeeklyConfig('gym', [1, 4])), true);
  });

  it('sees an added weekday as a move', () => {
    assert.equal(scheduleMoved(gym, aWeeklyConfig('gym', [1, 3, 5])), true);
  });
});

describe('a daily config that skips days', () => {
  const weekdaysOnly = aDailyConfig('water', {
    timesOfDay: hourlyBetween('09:00', '23:00', '02:00'), weekdays: [1, 2, 3, 4, 5],
  });

  it('sees dropping the weekend as a move, though no time changed', () => {
    assert.equal(scheduleMoved(water, weekdaysOnly), true);
  });

  it('ignores the order the days were tapped in', () => {
    const reordered = aDailyConfig('water', {
      timesOfDay: hourlyBetween('09:00', '23:00', '02:00'), weekdays: [5, 4, 3, 2, 1],
    });

    assert.equal(scheduleMoved(weekdaysOnly, reordered), false);
  });

  it('reads as the days it runs on and the times it fires at', () => {
    assert.equal(
      scheduleOf(weekdaysOnly),
      'daily:1,2,3,4,5@540,660,780,900,1020,1140,1260,1380',
    );
  });
});

describe('a moved schedule', () => {
  it('sees a different day of the month as a move', () => {
    assert.equal(scheduleMoved(rent, aMonthlyConfig('rent', { fromDay: 6, months: [9, 10] })), true);
  });

  it('sees a shifted set of times as a move', () => {
    const later = aDailyConfig('water', { timesOfDay: hourlyBetween('10:00', '23:00', '02:00') });

    assert.equal(scheduleMoved(water, later), true);
  });

  it('sees a denser set of times as a move', () => {
    const denser = aDailyConfig('water', { timesOfDay: hourlyBetween('09:00', '23:00', '00:30') });

    assert.equal(scheduleMoved(water, denser), true);
  });

  it('sees one added time as a move', () => {
    const extra = aDailyConfig('water', {
      timesOfDay: [...water.timesOfDay, timeOfDay('08:00')],
    });

    assert.equal(scheduleMoved(water, extra), true);
  });

});

describe('how two sets of times are compared', () => {
  it('compares them by the minute, not by object identity', () => {
    const rebuilt = { ...water, timesOfDay: water.timesOfDay.map((t) => ({ ...t })) };

    assert.equal(scheduleMoved(water, rebuilt), false);
  });

  it('ignores the order they were entered in', () => {
    const reversed = { ...water, timesOfDay: [...water.timesOfDay].reverse() };

    assert.equal(scheduleMoved(water, reversed), false);
  });
});

describe('what is not a schedule change', () => {
  it('a rename is not a move', () => {
    assert.equal(scheduleMoved(gym, { ...gym, name: 'Gym, but better' }), false);
  });

  it('new steps are not a move', () => {
    const withSteps = { ...gym, subtasks: [{ id: 'a', name: 'Squats' }] };

    assert.equal(scheduleMoved(gym, withSteps), false);
  });

  it('new links are not a move', () => {
    assert.equal(scheduleMoved(gym, { ...gym, links: ['https://example.com'] }), false);
  });

  it('a different category is not a move', () => {
    assert.equal(scheduleMoved(gym, { ...gym, category: TaskCategory.SELFCARE }), false);
  });

  it('a wider window is not a move — the dates are unchanged', () => {
    // This is the one people expect to be a move because it is "about time".
    // It is not: it changes how long an occurrence matters, never when it falls.
    const wider = { ...gym, remindBeforeMins: 30, activeBeforeMins: 60, activeForMins: 600 };

    assert.equal(scheduleMoved(gym, wider), false);
  });
});

describe('the schedule string itself', () => {
  it('names the kind, so two schedules of different types never collide', () => {
    assert.match(scheduleOf(water), /^daily:/);
    assert.match(scheduleOf(gym), /^weekly:/);
    assert.match(scheduleOf(rent), /^monthly:/);
  });

  it('reads as the schedule it describes', () => {
    // The times are part of every key now, so a weekly config carries its own.
    assert.equal(scheduleOf(gym), 'weekly:1,5@120');
    // `@` now separates the times, so the months moved behind a slash.
    assert.equal(scheduleOf(rent), 'monthly:5/9,10@120');
    assert.equal(
      scheduleOf(water),
      'daily:0,1,2,3,4,5,6@540,660,780,900,1020,1140,1260,1380',
    );
  });
});
