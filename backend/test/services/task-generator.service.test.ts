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
    const rent = aMonthlyConfig('rent', { fromDay: 1, toDay: 5, months: [9] });
    const { generator } = withTasks([gym, rent]);

    const gymEvent = await generator.ensurePendingEvent(gym, utc('Sat 2026-08-22 10:00'));
    const rentEvent = await generator.ensurePendingEvent(rent, utc('2026-08-19'));

    assert.deepEqual(gymEvent?.date, utc('Mon 2026-08-24 09:00'));
    assert.deepEqual(rentEvent?.date, utc('2026-09-01 09:00'));
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
