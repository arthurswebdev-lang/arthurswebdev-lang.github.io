import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActiveLogic } from '../../src/enum/active-logic.enum.js';
import { TaskFilter } from '../../src/enum/task-filter.enum.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import { TasksService } from '../../src/services/tasks.service.js';
import type { Task } from '../../src/types/tasks.types.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import { aBasicTask, anEvent } from '../support/tasks.js';
import { utc } from '../support/time.js';

/**
 * Seen from Saturday 22 August: one basic task with no date at all, an event
 * that has gone by, one whose week has not started, and one inside the rolling
 * 30-day window.
 */
const tasks: Task[] = [
  aBasicTask('buy milk'),
  anEvent('gym friday', 'Fri 2026-08-21', ActiveLogic.THIS_WEEK),
  anEvent('gym monday', 'Mon 2026-08-24', ActiveLogic.THIS_WEEK),
  anEvent('rent', '2026-09-01', ActiveLogic.NEXT_30_DAYS),
];

const saturday = utc('Sat 2026-08-22 10:00');

function serviceWith(stored: Task[]): TasksService {
  const repository = new InMemoryTasksRepository(stored);
  const generator = new TaskGeneratorService(repository, new InMemoryRepeatedTasksRepository([]));

  return new TasksService(repository, generator, () => saturday);
}

describe('GET /tasks without a filter', () => {
  it('returns everything, basic tasks included', async () => {
    const listed = await serviceWith(tasks).listAll();

    assert.deepEqual(listed.map((task) => task.name), ['buy milk', 'gym friday', 'gym monday', 'rent']);
  });
});

describe('GET /tasks?filter=...', () => {
  it('actual returns only what is relevant right now', async () => {
    const listed = await serviceWith(tasks).listAll(TaskFilter.ACTUAL);

    assert.deepEqual(listed.map((task) => task.name), ['rent']);
  });

  it('passed returns what has gone by', async () => {
    const listed = await serviceWith(tasks).listAll(TaskFilter.PASSED);

    assert.deepEqual(listed.map((task) => task.name), ['gym friday']);
  });

  it('upcoming returns what is too far out to be actual', async () => {
    const listed = await serviceWith(tasks).listAll(TaskFilter.UPCOMING);

    assert.deepEqual(listed.map((task) => task.name), ['gym monday']);
  });

  it('drops basic tasks from every filtered list', async () => {
    const service = serviceWith(tasks);

    const lists = await Promise.all(
      Object.values(TaskFilter).map((filter) => service.listAll(filter)),
    );

    for (const listed of lists) {
      assert.equal(listed.some((task) => task.name === 'buy milk'), false);
    }
  });
});
