import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActiveLogic } from '../../src/enum/active-logic.enum.js';
import { TaskFilter } from '../../src/enum/task-filter.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import {
  activeLogicForRepeatedTask,
  endOfDay,
  endOfNext30Days,
  endOfThisWeek,
  eventsOfConfig,
  filterTasks,
  isActualEvent,
  isEventTask,
  isGeneratedEvent,
  isMarkedPassed,
  isPassedEvent,
  isUpcomingEvent,
  isWithinNext30Days,
  isWithinThisWeek,
  isWithinToday,
  pendingEventOfConfig,
  startOfDay,
} from '../../src/filters/tasks.filters.js';
import type { Task } from '../../src/types/tasks.types.js';
import {
  aBasicTask, aDailyEvent, aHandMadeEvent, aMonthlyEvent, anEvent, aWeeklyConfig, aWeeklyEvent,
} from '../support/tasks.js';
import { utc, weekdayOf } from '../support/time.js';

describe('day boundaries are UTC', () => {
  it('starts the day at UTC midnight', () => {
    assert.deepEqual(startOfDay(utc('2026-08-19 11:45')), utc('2026-08-19 00:00'));
  });

  it('ends the day at the last UTC millisecond', () => {
    assert.deepEqual(endOfDay(utc('2026-08-19 11:45')), utc('2026-08-19 23:59:59.999'));
  });

  it('does not drift when the instant is near a local-midnight boundary', () => {
    // 23:30 UTC is already "tomorrow" in any timezone east of UTC+1. Reading it
    // as UTC is what keeps the classification identical everywhere.
    assert.deepEqual(startOfDay(utc('2026-08-19 23:30')), utc('2026-08-19 00:00'));
  });
});

describe('endOfThisWeek — the week stops on Sunday', () => {
  it('reaches tomorrow night when today is Saturday', () => {
    assert.deepEqual(endOfThisWeek(utc('Sat 2026-08-22 10:00')), utc('Sun 2026-08-23 23:59:59.999'));
  });

  it('reaches the coming Sunday from midweek', () => {
    assert.deepEqual(endOfThisWeek(utc('Tue 2026-08-18 09:00')), utc('Sun 2026-08-23 23:59:59.999'));
  });

  it('shrinks to today when today is Sunday (open question Q7)', () => {
    assert.deepEqual(endOfThisWeek(utc('Sun 2026-08-23 10:00')), utc('Sun 2026-08-23 23:59:59.999'));
  });
});

describe('endOfNext30Days — rolling, not the calendar month', () => {
  it('reaches into the following month', () => {
    assert.deepEqual(endOfNext30Days(utc('2026-08-19 12:00')), utc('2026-09-18 23:59:59.999'));
  });
});

describe('telling the kinds of task apart', () => {
  it('recognises event tasks', () => {
    assert.equal(isEventTask(aDailyEvent('water', '2026-08-19 13:00')), true);
    assert.equal(isEventTask(aBasicTask('buy milk')), false);
  });

  it('maps each config type to the window its events use', () => {
    assert.equal(activeLogicForRepeatedTask(aWeeklyConfig('gym', [1])), ActiveLogic.THIS_WEEK);
  });
});

describe('daily — "drink water", grid 09:00 to 23:00 every 2h', () => {
  it('is actual at 11:45 when the next pour is 13:00 today', () => {
    assert.equal(isActualEvent(aDailyEvent('water', '2026-08-19 13:00'), utc('2026-08-19 11:45')), true);
  });

  it('is passed once 13:01 arrives', () => {
    assert.equal(isPassedEvent(aDailyEvent('water', '2026-08-19 13:00'), utc('2026-08-19 13:01')), true);
  });

  it('makes 15:00 the actual one after 13:00 goes by (grid, so not 14:00)', () => {
    assert.equal(isActualEvent(aDailyEvent('water', '2026-08-19 15:00'), utc('2026-08-19 13:01')), true);
  });

  it('is upcoming, not actual, at 23:30 when the next pour is tomorrow 09:00', () => {
    const tomorrowsFirst = aDailyEvent('water', '2026-08-20 09:00');
    const lateTonight = utc('2026-08-19 23:30');

    assert.equal(isWithinToday(tomorrowsFirst.date, lateTonight), false);
    assert.equal(isUpcomingEvent(tomorrowsFirst, lateTonight), true);
    assert.equal(isActualEvent(tomorrowsFirst, lateTonight), false);
  });
});

describe('weekly — a session still inside this week', () => {
  it('is actual midweek when the next session is still this week', () => {
    const friday = aWeeklyEvent('gym', 'Fri 2026-08-21');

    assert.equal(isActualEvent(friday, utc('Tue 2026-08-18 09:00')), true);
    assert.equal(isActualEvent(friday, utc('Thu 2026-08-20 09:00')), true);
  });
});

describe('weekly — a session that belongs to next week', () => {
  it('hides next Monday while it is still Saturday — the new week has not started', () => {
    const nextMonday = aWeeklyEvent('gym', 'Mon 2026-08-24');
    const saturday = utc('Sat 2026-08-22 10:00');

    assert.equal(isWithinThisWeek(nextMonday.date, saturday), false);
    assert.equal(isUpcomingEvent(nextMonday, saturday), true);
  });

  it('still hides it on Sunday, the last day of the old week', () => {
    assert.equal(
      isUpcomingEvent(aWeeklyEvent('gym', 'Mon 2026-08-24'), utc('Sun 2026-08-23 10:00')),
      true,
    );
  });

  it('brings it into the window once Monday starts', () => {
    assert.equal(
      isWithinThisWeek(utc('Mon 2026-08-24'), utc('Mon 2026-08-24 08:00')),
      true,
    );
  });
});

describe('weekly — Q15, the midnight problem', () => {
  it('OPEN QUESTION Q15: a 00:00 event reads as passed all through its own day', () => {
    // Documents today's behaviour, not an endorsement of it. Because generated
    // weekly events sit at 00:00, the event is passed from the first instant of
    // the day the user is meant to act on it.
    const monday = aWeeklyEvent('gym', 'Mon 2026-08-24');

    assert.equal(isPassedEvent(monday, utc('Mon 2026-08-24 00:00')), true);
    assert.equal(isPassedEvent(monday, utc('Mon 2026-08-24 08:00')), true);
    assert.equal(isActualEvent(monday, utc('Mon 2026-08-24 08:00')), false);
  });
});

describe('monthly — rolling 30 days', () => {
  const today = utc('2026-08-19 12:00');

  it('counts 1 September as actual on 19 August (13 days out, next calendar month)', () => {
    assert.equal(isWithinNext30Days(utc('2026-09-01'), today), true);
    assert.equal(isActualEvent(aMonthlyEvent('rent', '2026-09-01'), today), true);
  });

  it('leaves 25 September upcoming (37 days out)', () => {
    assert.equal(isWithinNext30Days(utc('2026-09-25'), today), false);
    assert.equal(isUpcomingEvent(aMonthlyEvent('rent', '2026-09-25'), today), true);
  });

  it('includes the last day of the window and excludes the next one', () => {
    assert.equal(isWithinNext30Days(utc('2026-09-18 23:00'), today), true);
    assert.equal(isWithinNext30Days(utc('2026-09-19 00:00'), today), false);
  });
});

describe('the three states are exclusive', () => {
  const now = utc('2026-08-19 12:00');

  it('puts every event in exactly one state', () => {
    const events = [
      aDailyEvent('past', '2026-08-19 09:00'),
      aDailyEvent('later today', '2026-08-19 15:00'),
      aMonthlyEvent('far off', '2026-12-01'),
    ];

    for (const event of events) {
      const states = [isPassedEvent(event, now), isActualEvent(event, now), isUpcomingEvent(event, now)];

      assert.equal(states.filter(Boolean).length, 1, `${event.name} landed in ${String(states)}`);
    }
  });

  it('reads passed from the date, not from the poller stamp', () => {
    // The poller runs a minute behind, so passedDate is still null here.
    const justExpired = aDailyEvent('water', '2026-08-19 11:59');

    assert.equal(isMarkedPassed(justExpired), false);
    assert.equal(isPassedEvent(justExpired, now), true);
  });
});

describe('events belonging to a config', () => {
  const now = utc('2026-08-19 12:00');
  const generated = aDailyEvent('water', '2026-08-19 15:00');
  const byHand = aHandMadeEvent('dentist', '2026-08-20 09:00', ActiveLogic.TODAY);

  it('knows which events a config produced', () => {
    assert.equal(isGeneratedEvent(generated), true);
    assert.equal(isGeneratedEvent(byHand), false);
    assert.deepEqual(eventsOfConfig([generated, byHand], 'config-1'), [generated]);
  });

  it('finds the one pending event, ignoring the ones already gone by', () => {
    const alreadyPassed = aDailyEvent('water', '2026-08-19 09:00');
    const tasks: Task[] = [alreadyPassed, generated];

    assert.equal(pendingEventOfConfig(tasks, 'config-1', now)?.date.toISOString(), generated.date.toISOString());
  });

  it('returns null when the config has nothing pending', () => {
    assert.equal(pendingEventOfConfig([aDailyEvent('water', '2026-08-19 09:00')], 'config-1', now), null);
  });
});

const saturday = utc('Sat 2026-08-22 10:00');

/** One of each kind, seen from Saturday: a config, a basic, and three events. */
const mixedList: Task[] = [
  aBasicTask('buy milk'),
  aWeeklyEvent('gym friday', 'Fri 2026-08-21'),
  aWeeklyEvent('gym monday', 'Mon 2026-08-24'),
  aMonthlyEvent('rent', '2026-09-01'),
];

const namesFor = (filter: TaskFilter | undefined) =>
  filterTasks(mixedList, filter, saturday).map((task) => task.name);

describe('filterTasks over a mixed list', () => {
  it('returns everything, configs included, when no filter is given', () => {
    assert.deepEqual(namesFor(undefined), ['buy milk', 'gym friday', 'gym monday', 'rent']);
  });

  it('returns only what is relevant now under actual', () => {
    assert.deepEqual(namesFor(TaskFilter.ACTUAL), ['rent']);
  });

  it('returns what has gone by under passed', () => {
    assert.deepEqual(namesFor(TaskFilter.PASSED), ['gym friday']);
  });

  it('returns what is too far out under upcoming', () => {
    assert.deepEqual(namesFor(TaskFilter.UPCOMING), ['gym monday']);
  });

  it('never returns basic tasks from a filtered list', () => {
    for (const filter of Object.values(TaskFilter)) {
      const kinds = filterTasks(mixedList, filter, saturday).map((task) => task.type);

      assert.deepEqual([...new Set(kinds)].filter((kind) => kind !== TaskType.EVENT), []);
    }
  });
});

describe('the test clock itself', () => {
  it('reads dates as UTC regardless of the machine timezone', () => {
    assert.equal(utc('2026-08-22 10:00').toISOString(), '2026-08-22T10:00:00.000Z');
  });

  it('catches a weekday that does not match the date', () => {
    assert.equal(weekdayOf(utc('2026-08-22')), 'Sat');
    assert.throws(() => utc('Mon 2026-08-22 10:00'), /is a Sat, not a Mon/);
  });

  it('accepts an event built with a plain date as UTC midnight', () => {
    assert.equal(anEvent('x', '2026-08-22', ActiveLogic.TODAY).date.toISOString(), '2026-08-22T00:00:00.000Z');
  });
});
