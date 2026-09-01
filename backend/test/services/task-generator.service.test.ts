import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { isEventTask, pendingEventOfConfig } from '../../src/filters/tasks.filters.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import type { EventTask, Task } from '../../src/types/tasks.types.js';
import type { RepeatedTask } from '../../src/types/repeated-tasks.types.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import {
  aDailyConfig, aMonthlyConfig, aWeeklyConfig,
} from '../support/tasks.js';
import { utc } from '../support/time.js';

const water = aDailyConfig('water', { startsAt: '09:00', endsAt: '23:00', repeatEach: '02:00' });

/** Configs go in the configs store; everything else in the tasks store. */
function withTasks(configs: RepeatedTask[], tasks: Task[] = []) {
  const repository = new InMemoryTasksRepository(tasks);
  const configRepository = new InMemoryRepeatedTasksRepository(configs);

  return { repository, generator: new TaskGeneratorService(repository, configRepository) };
}

const eventsIn = (repository: InMemoryTasksRepository): EventTask[] =>
  repository.snapshot().filter(isEventTask);

describe('generating a config\'s first event', () => {
  it('creates the next occurrence when the config has nothing pending', async () => {
    const { repository, generator } = withTasks([water]);

    const created = await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));

    assert.deepEqual(created?.date, utc('2026-08-19 13:00'));
    assert.equal(eventsIn(repository).length, 1);
  });

  it('copies the config name and links the event back to it', async () => {
    const { generator } = withTasks([water]);

    const created = await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));

    assert.ok(created !== null);
    assert.equal(created.name, 'water');
    assert.equal(created.configTaskId, water.id);
    assert.equal(created.status, TaskStatus.TODO);
    assert.equal(created.passedDate, null);
  });

});

describe('generating for weekly and monthly configs', () => {
  it('gives a weekly event THIS_WEEK logic and a monthly one NEXT_10_DAYS', async () => {
    const gym = aWeeklyConfig('gym', [1, 5]);
    const rent = aMonthlyConfig('rent', { fromDay: 1, months: [9] });
    const { generator } = withTasks([gym, rent]);

    const gymEvent = await generator.ensurePendingEvent(gym, utc('Sat 2026-08-22 10:00'));
    const rentEvent = await generator.ensurePendingEvent(rent, utc('2026-08-19'));

    assert.deepEqual(gymEvent?.date, utc('Mon 2026-08-24 02:00'));
    assert.deepEqual(rentEvent?.date, utc('2026-09-01 02:00'));
  });
});

/** A weekly config carrying a checklist, the way a gym routine would. */
const gymWithSteps = aWeeklyConfig('gym', [1, 5], {
  subtasks: [
    { id: 'step-squats', name: 'Squats 5x5' },
    { id: 'step-bench', name: 'Bench 5x5', link: 'https://example.com/bench' },
  ],
});

describe('a config\'s steps become the occurrence\'s steps', () => {
  it('stamps the config checklist onto the event, untouched and undone', async () => {
    const { generator } = withTasks([gymWithSteps]);

    const event = await generator.ensurePendingEvent(gymWithSteps, utc('Sat 2026-08-22 10:00'));
    assert.ok(event !== null);

    assert.deepEqual(event.subtasks.map((step) => step.name), ['Squats 5x5', 'Bench 5x5']);
    assert.deepEqual(event.subtasks.map((step) => step.status), [TaskStatus.TODO, TaskStatus.TODO]);
    assert.equal(event.subtasks[1]?.link, 'https://example.com/bench');
  });

  it('leaves an event with no steps when its config has none', async () => {
    const standup = aWeeklyConfig('standup', [1]);
    const { generator } = withTasks([standup]);

    const event = await generator.ensurePendingEvent(standup, utc('Sat 2026-08-22 10:00'));
    assert.ok(event !== null);

    assert.deepEqual(event.subtasks, []);
  });
});

describe('each occurrence owns its own steps', () => {
  it('gives the next occurrence fresh ids, so ticking one leaves it alone', async () => {
    const { repository, generator } = withTasks([gymWithSteps]);

    const first = await generator.ensurePendingEvent(gymWithSteps, utc('Sat 2026-08-22 10:00'));
    assert.ok(first !== null);

    // Finish it, and let the config produce the occurrence after it.
    await repository.updateStatus(first.id, TaskStatus.DONE);
    const second = await generator.generateNextAfter(first, utc('Mon 2026-08-24 07:00'));
    assert.ok(second !== null);

    const firstIds = first.subtasks.map((step) => step.id);
    const secondIds = second.subtasks.map((step) => step.id);

    assert.equal(secondIds.length, 2);
    assert.ok(
      secondIds.every((id) => !firstIds.includes(id)),
      'the new occurrence reused a step id from the finished one',
    );
    assert.deepEqual(second.subtasks.map((step) => step.status), [TaskStatus.TODO, TaskStatus.TODO]);
  });
});

describe('the one-pending-event invariant', () => {
  it('does not generate a second event while one is still pending', async () => {
    const { repository, generator } = withTasks([water]);
    const now = utc('2026-08-19 11:45');

    await generator.ensurePendingEvent(water, now);
    const second = await generator.ensurePendingEvent(water, now);

    assert.equal(second, null);
    assert.equal(eventsIn(repository).length, 1);
  });

  it('generates the follow-up once the pending one has gone by', async () => {
    const { repository, generator } = withTasks([water]);

    await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));
    const next = await generator.ensurePendingEvent(water, utc('2026-08-19 13:01'));

    assert.deepEqual(next?.date, utc('2026-08-19 15:00'));
    assert.equal(eventsIn(repository).length, 2);
  });

  it('leaves the passed event in place for the user to deal with', async () => {
    const { repository, generator } = withTasks([water]);

    await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));
    await generator.ensurePendingEvent(water, utc('2026-08-19 13:01'));

    const dates = eventsIn(repository).map((event) => event.date.toISOString());

    assert.deepEqual(dates, [utc('2026-08-19 13:00').toISOString(), utc('2026-08-19 15:00').toISOString()]);
  });
});

describe('marking events passed', () => {
  it('stamps only the events whose moment has gone by', async () => {
    const { repository, generator } = withTasks([water]);
    await generator.ensurePendingEvent(water, utc('2026-08-19 08:00'));

    const stamped = await generator.markPassedEvents(utc('2026-08-19 09:30'));

    assert.equal(stamped.length, 1);
    assert.deepEqual(eventsIn(repository)[0]?.passedDate, utc('2026-08-19 09:30'));
  });

  it('leaves a pending event alone', async () => {
    const { repository, generator } = withTasks([water]);
    await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));

    const stamped = await generator.markPassedEvents(utc('2026-08-19 12:00'));

    assert.equal(stamped.length, 0);
    assert.equal(eventsIn(repository)[0]?.passedDate, null);
  });

  it('does not re-stamp an event that is already marked', async () => {
    const { generator } = withTasks([water]);
    await generator.ensurePendingEvent(water, utc('2026-08-19 08:00'));
    await generator.markPassedEvents(utc('2026-08-19 09:30'));

    const again = await generator.markPassedEvents(utc('2026-08-19 10:00'));

    assert.equal(again.length, 0);
  });
});

describe('syncing every config in one pass', () => {
  it('tops up each config that has nothing pending', async () => {
    const gym = aWeeklyConfig('gym', [1, 5]);
    const { repository, generator } = withTasks([water, gym]);

    const generated = await generator.syncPendingEvents(utc('Wed 2026-08-19 11:45'));

    assert.equal(generated.length, 2);
    assert.equal(eventsIn(repository).length, 2);
  });

  it('is idempotent — a second pass at the same instant adds nothing', async () => {
    const gym = aWeeklyConfig('gym', [1, 5]);
    const { repository, generator } = withTasks([water, gym]);
    const now = utc('Wed 2026-08-19 11:45');

    await generator.syncPendingEvents(now);
    const second = await generator.syncPendingEvents(now);

    assert.equal(second.length, 0);
    assert.equal(eventsIn(repository).length, 2);
  });

  it('generates only the next occurrence after downtime, not the missed ones (B4)', async () => {
    const { repository, generator } = withTasks([water]);

    // The config existed all weekend but nothing ran. One pass on Monday.
    const generated = await generator.syncPendingEvents(utc('Mon 2026-08-24 10:30'));

    assert.equal(generated.length, 1);
    assert.deepEqual(eventsIn(repository)[0]?.date, utc('Mon 2026-08-24 11:00'));
  });
});

describe('finishing an event early (B3)', () => {
  it('brings the following occurrence forward', async () => {
    const { repository, generator } = withTasks([water]);
    const pending = await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));
    assert.ok(pending !== null);

    const next = await generator.generateNextAfter(pending, utc('2026-08-19 12:10'));

    assert.deepEqual(next?.date, utc('2026-08-19 15:00'));
    assert.equal(eventsIn(repository).length, 2);
  });

  it('skips the occurrence just finished rather than recreating it', async () => {
    const { generator } = withTasks([water]);
    const pending = await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));
    assert.ok(pending !== null);

    const next = await generator.generateNextAfter(pending, utc('2026-08-19 12:10'));

    assert.notDeepEqual(next?.date, pending.date);
  });

  it('does nothing for an event no config produced', async () => {
    const { generator } = withTasks([water]);
    const pending = await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));
    assert.ok(pending !== null);

    const orphan = { ...pending, configTaskId: null };

    assert.equal(await generator.generateNextAfter(orphan, utc('2026-08-19 12:10')), null);
  });
});

/**
 * Reported from the phone: a 14:00 occurrence sitting in Passed was ticked off,
 * and switching to Actual showed the 15:00 one twice.
 *
 * The poller had already generated the successor when 14:00 went by, and
 * finishing the passed event generated it a second time.
 */
async function afterAPassedTick() {
  const { repository, generator } = withTasks([water]);
  const passed = await generator.ensurePendingEvent(water, utc('2026-08-19 12:45'));
  assert.ok(passed !== null);

  // 13:00 goes by, and the poller tops the config back up with 15:00.
  const afterwards = utc('2026-08-19 13:00:49');
  await generator.markPassedEvents(afterwards);
  await generator.syncPendingEvents(afterwards);

  return {
    repository, generator, passed, afterwards,
  };
}

describe('finishing an event that had already passed', () => {
  it('does not generate a second copy of the successor the poller made', async () => {
    const {
      repository, generator, passed, afterwards,
    } = await afterAPassedTick();
    assert.equal(eventsIn(repository).length, 2);

    const next = await generator.generateNextAfter({ ...passed, status: TaskStatus.DONE }, afterwards);

    assert.equal(next, null);
    assert.deepEqual(
      eventsIn(repository).map((event) => event.date),
      [utc('2026-08-19 13:00'), utc('2026-08-19 15:00')],
    );
  });

  it('still generates when the poller has not got there yet', async () => {
    const { repository, generator } = withTasks([water]);
    const passed = await generator.ensurePendingEvent(water, utc('2026-08-19 12:45'));
    assert.ok(passed !== null);

    // No poll in between: nothing else exists, so finishing it must move on.
    const finished = { ...passed, status: TaskStatus.DONE };
    const next = await generator.generateNextAfter(finished, utc('2026-08-19 13:00:49'));

    assert.deepEqual(next?.date, utc('2026-08-19 15:00'));
    assert.equal(eventsIn(repository).length, 2);
  });
});

// The guard must not harden into "one event per config, ever": a sibling that
// has itself been finished is not something to keep waiting on.
describe('a sibling that was also finished', () => {
  it('does not block the next occurrence', async () => {
    const { repository, generator } = withTasks([water]);
    const first = await generator.ensurePendingEvent(water, utc('2026-08-19 12:45'));
    assert.ok(first !== null);
    const second = await generator.generateNextAfter(first, utc('2026-08-19 12:50'));
    assert.ok(second !== null);

    // 13:00 is done but has not passed yet, so only its status stops it
    // counting as the successor still being waited on.
    await repository.updateStatus(first.id, TaskStatus.DONE);
    const next = await generator.generateNextAfter(
      { ...second, status: TaskStatus.DONE },
      utc('2026-08-19 12:55'),
    );

    assert.deepEqual(next?.date, utc('2026-08-19 17:00'));
    assert.equal(eventsIn(repository).length, 3);
  });
});

/**
 * The window must not gate generation. `pendingEventOfConfig` asks whether the
 * moment has gone by, not whether the user is still allowed to act on it —
 * otherwise a config repeating more often than its window is long silently
 * loses the occurrences in between.
 */
describe('a window longer than the repeat interval', () => {
  it('still generates every occurrence on the grid', async () => {
    const slow = aDailyConfig('water', { startsAt: '09:00', endsAt: '23:00', repeatEach: '02:00' });
    const wide = { ...slow, activeForMins: 3 * 60 };
    const { repository, generator } = withTasks([wide]);

    await generator.ensurePendingEvent(wide, utc('2026-08-19 08:00'));
    // 09:00 has gone by but its three-hour window is still open at 09:01.
    await generator.syncPendingEvents(utc('2026-08-19 09:01'));

    assert.deepEqual(
      eventsIn(repository).map((event) => event.date),
      [utc('2026-08-19 09:00'), utc('2026-08-19 11:00')],
    );
  });
});

describe('regenerating after a config is edited (B5)', () => {
  it('clears every existing event and creates one fresh', async () => {
    const { repository, generator } = withTasks([water]);
    await generator.ensurePendingEvent(water, utc('2026-08-19 08:00'));
    await generator.ensurePendingEvent(water, utc('2026-08-19 09:30'));
    assert.equal(eventsIn(repository).length, 2);

    const regenerated = await generator.regenerateForConfig(water, utc('2026-08-19 11:45'));

    assert.equal(eventsIn(repository).length, 1);
    assert.deepEqual(regenerated?.date, utc('2026-08-19 13:00'));
  });

});

describe('regenerating follows the edited schedule', () => {
  it('follows the new schedule, not the old one', async () => {
    const { repository, generator } = withTasks([water]);
    await generator.ensurePendingEvent(water, utc('2026-08-19 11:45'));

    const rescheduled = aDailyConfig('water', { startsAt: '09:00', endsAt: '23:00', repeatEach: '00:30' });
    const regenerated = await generator.regenerateForConfig(
      { ...rescheduled, id: water.id },
      utc('2026-08-19 11:45'),
    );

    assert.deepEqual(regenerated?.date, utc('2026-08-19 12:00'));
    assert.equal(eventsIn(repository).length, 1);
  });

  it('leaves the store with exactly one pending event afterwards', async () => {
    const { repository, generator } = withTasks([water]);
    await generator.ensurePendingEvent(water, utc('2026-08-19 08:00'));

    await generator.regenerateForConfig(water, utc('2026-08-19 11:45'));

    const pending = pendingEventOfConfig(repository.snapshot(), water.id, utc('2026-08-19 11:45'));

    assert.ok(pending !== null);
  });
});

describe('configs that can never fire', () => {
  it('generates nothing for a zero repeatEach', async () => {
    const broken = aDailyConfig('water', { startsAt: '09:00', endsAt: '23:00', repeatEach: '00:00' });
    const { repository, generator } = withTasks([broken]);

    assert.equal(await generator.ensurePendingEvent(broken, utc('2026-08-19 11:45')), null);
    assert.equal(eventsIn(repository).length, 0);
  });
});
