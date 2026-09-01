import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskFilter } from '../../src/enum/task-filter.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import {
  activeFrom,
  activeUntil,
  eventsOfConfig,
  filterTasks,
  isActualEvent,
  isEventTask,
  isGeneratedEvent,
  isMarkedPassed,
  isPassedEvent,
  isUpcomingEvent,
  pendingEventOfConfig,
  remindAt,
} from '../../src/filters/tasks.filters.js';
import type { Task } from '../../src/types/tasks.types.js';
import {
  aBasicTask, aHandMadeEvent, anEvent, anEventWindowed, days, hours,
} from '../support/tasks.js';
import { utc, weekdayOf } from '../support/time.js';

/**
 * The interview from the design discussion, and the reason the three fields
 * exist: reminded at 14:50, visible from 14:00, spent at 18:00.
 */
const interview = anEvent('interview', 'Fri 2026-09-04 15:00', {
  remindBeforeMins: 10,
  activeBeforeMins: hours(1),
  activeForMins: hours(3),
});

describe('the three moments of an event', () => {
  it('works the reminder back from the date', () => {
    assert.deepEqual(remindAt(interview), utc('Fri 2026-09-04 14:50'));
  });

  it('works the start of the window back from the date', () => {
    assert.deepEqual(activeFrom(interview), utc('Fri 2026-09-04 14:00'));
  });

  it('works the end of the window forward from the date', () => {
    assert.deepEqual(activeUntil(interview), utc('Fri 2026-09-04 18:00'));
  });

  it('collapses onto the date itself when the durations are zero', () => {
    const exact = anEvent('exact', '2026-09-04 15:00', { remindBeforeMins: 0, activeBeforeMins: 0 });

    assert.deepEqual(remindAt(exact), exact.date);
    assert.deepEqual(activeFrom(exact), exact.date);
  });
});

describe('walking the interview through its window', () => {
  const stateAt = (clock: string) => {
    const now = utc(clock);
    if (isPassedEvent(interview, now)) return 'passed';

    return isActualEvent(interview, now) ? 'actual' : 'upcoming';
  };

  it('is upcoming until an hour before', () => {
    assert.equal(stateAt('Fri 2026-09-04 13:59'), 'upcoming');
  });

  it('turns actual exactly on activeFrom', () => {
    assert.equal(stateAt('Fri 2026-09-04 14:00'), 'actual');
  });

  it('is still actual while the interview is happening', () => {
    assert.equal(stateAt('Fri 2026-09-04 15:30'), 'actual');
  });

  it('is still actual at the last instant of its window', () => {
    assert.equal(stateAt('Fri 2026-09-04 18:00'), 'actual');
  });

  it('is passed a minute later', () => {
    assert.equal(stateAt('Fri 2026-09-04 18:01'), 'passed');
  });

  it('no longer sits in the list for a week beforehand', () => {
    // The old default was NEXT_10_DAYS, which made this read as actual from
    // 26 August — nine days of an interview at the top of the list.
    assert.equal(stateAt('2026-08-28 09:00'), 'upcoming');
  });
});

/** Four windows of very different shapes, including one with no lead at all. */
const assortedEvents = [
  anEventWindowed('short', '2026-08-19 09:00', hours(1), 10),
  anEventWindowed('long', '2026-08-19 15:00', days(3), days(1)),
  anEventWindowed('far off', '2026-12-01 09:00', days(10), hours(2)),
  anEventWindowed('zero lead', '2026-08-19 12:00', 0, 30),
];

const assortedInstants = [
  '2026-08-01 00:00', '2026-08-19 08:59', '2026-08-19 09:00', '2026-08-19 12:00',
  '2026-08-19 15:00', '2026-08-20 15:00', '2026-12-01 11:00', '2027-01-01 00:00',
];

describe('the three states partition the timeline', () => {
  it('puts every event in exactly one state, at every instant', () => {
    for (const clock of assortedInstants) {
      const now = utc(clock);
      for (const event of assortedEvents) {
        const states = [
          isPassedEvent(event, now), isActualEvent(event, now), isUpcomingEvent(event, now),
        ];
        const landed = states.filter(Boolean).length;

        assert.equal(landed, 1, `"${event.name}" at ${clock} landed in ${String(states)}`);
      }
    }
  });
});

describe('passed is read from the window, not the stamp', () => {
  it('calls a just-expired event passed before the poller catches up', () => {
    // The poller runs a minute behind, so passedDate is still null here.
    const justExpired = anEventWindowed('water', '2026-08-19 11:49', hours(1), 10);

    assert.equal(isMarkedPassed(justExpired), false);
    assert.equal(isPassedEvent(justExpired, utc('2026-08-19 12:00')), true);
  });
});

describe('a long window outlives its own date', () => {
  const bills = anEventWindowed('bills', '2026-09-08 09:00', days(1), days(3));

  it('stays actual days after the date, rather than reading as future', () => {
    // Under the old calendar windows this was the trap: two days in, the date
    // sat behind startOfDay(now), so every window rejected it and the task was
    // filed under Upcoming — in the future, while being the thing to do now.
    const twoDaysIn = utc('2026-09-10 12:00');

    assert.equal(isUpcomingEvent(bills, twoDaysIn), false);
    assert.equal(isActualEvent(bills, twoDaysIn), true);
  });

  it('passes when the window closes, not when the date goes by', () => {
    assert.equal(isPassedEvent(bills, utc('2026-09-10 12:00')), false);
    assert.equal(isPassedEvent(bills, utc('2026-09-11 09:01')), true);
  });
});

describe('telling the kinds of task apart', () => {
  it('sees only dated tasks as events', () => {
    assert.equal(isEventTask(anEvent('gym', '2026-08-19 09:00')), true);
    assert.equal(isEventTask(aBasicTask('buy milk')), false);
  });
});

describe('events belonging to a config', () => {
  const now = utc('2026-08-19 12:00');
  const generated = anEvent('water', '2026-08-19 15:00');
  const byHand = aHandMadeEvent('dentist', '2026-08-20 09:00');

  it('knows which events a config produced', () => {
    assert.equal(isGeneratedEvent(generated), true);
    assert.equal(isGeneratedEvent(byHand), false);
    assert.deepEqual(eventsOfConfig([generated, byHand], 'config-1'), [generated]);
  });

  it('finds the one pending event, ignoring the ones already gone by', () => {
    const alreadyPassed = anEvent('water', '2026-08-19 09:00');
    const tasks: Task[] = [alreadyPassed, generated];

    assert.equal(
      pendingEventOfConfig(tasks, 'config-1', now)?.date.toISOString(),
      generated.date.toISOString(),
    );
  });

  it('keys off the date, not the window, so a long window cannot stall the next one', () => {
    // A three-day window on a task whose date has gone by must not count as
    // still pending, or the config would skip occurrences.
    const wideButSpent = anEventWindowed('water', '2026-08-19 09:00', hours(1), days(3));

    assert.equal(isPassedEvent(wideButSpent, now), false);
    assert.equal(pendingEventOfConfig([wideButSpent], 'config-1', now), null);
  });
});

const saturday = utc('Sat 2026-08-22 10:00');

/** One of each kind, seen from Saturday: a basic and three events. */
const mixedList: Task[] = [
  aBasicTask('buy milk'),
  anEventWindowed('gym friday', 'Fri 2026-08-21 09:00', hours(2), hours(2)),
  anEventWindowed('gym monday', 'Mon 2026-08-24 09:00', hours(2), hours(2)),
  anEventWindowed('rent', '2026-09-01 09:00', days(10), hours(2)),
];

const namesFor = (filter: TaskFilter | undefined) =>
  filterTasks(mixedList, filter, saturday).map((task) => task.name);

describe('filterTasks over a mixed list', () => {
  it('returns everything when no filter is given', () => {
    assert.deepEqual(namesFor(undefined), ['buy milk', 'gym friday', 'gym monday', 'rent']);
  });

  it('returns only what is relevant now under actual', () => {
    assert.deepEqual(namesFor(TaskFilter.ACTUAL), ['buy milk', 'rent']);
  });

  it('returns what has gone by under passed', () => {
    assert.deepEqual(namesFor(TaskFilter.PASSED), ['gym friday']);
  });

  it('returns what is too far out under upcoming', () => {
    assert.deepEqual(namesFor(TaskFilter.UPCOMING), ['gym monday']);
  });

  it('keeps dateless tasks under actual, and only there', () => {
    const named = (filter: TaskFilter) => filterTasks(mixedList, filter, saturday)
      .filter((task) => task.type === TaskType.BASIC)
      .map((task) => task.name);

    assert.deepEqual(named(TaskFilter.ACTUAL), ['buy milk']);
    assert.deepEqual(named(TaskFilter.PASSED), []);
    assert.deepEqual(named(TaskFilter.UPCOMING), []);
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
    assert.equal(anEvent('x', '2026-08-22').date.toISOString(), '2026-08-22T00:00:00.000Z');
  });
});
