import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActiveLogic } from '../../src/enum/active-logic.enum.js';
import { TaskFilter } from '../../src/enum/task-filter.enum.js';
import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import { TasksService } from '../../src/services/tasks.service.js';
import type { Task } from '../../src/types/tasks.types.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import { aBasicTask, anEvent } from '../support/tasks.js';
import { TEST_USER_ID } from '../support/tasks.js';
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
    const listed = await serviceWith(tasks).listAll({ userId: TEST_USER_ID });

    assert.deepEqual(listed.map((task) => task.name), ['buy milk', 'gym friday', 'gym monday', 'rent']);
  });
});

describe('GET /tasks?filter=...', () => {
  it('actual returns what is relevant right now, dateless tasks included', async () => {
    const listed = await serviceWith(tasks).listAll({ userId: TEST_USER_ID, filter: TaskFilter.ACTUAL });

    assert.deepEqual(listed.map((task) => task.name), ['buy milk', 'rent']);
  });

  it('passed returns what has gone by', async () => {
    const listed = await serviceWith(tasks).listAll({ userId: TEST_USER_ID, filter: TaskFilter.PASSED });

    assert.deepEqual(listed.map((task) => task.name), ['gym friday']);
  });

  it('upcoming returns what is too far out to be actual', async () => {
    const listed = await serviceWith(tasks).listAll({ userId: TEST_USER_ID, filter: TaskFilter.UPCOMING });

    assert.deepEqual(listed.map((task) => task.name), ['gym monday']);
  });

  it('puts a basic task under actual and nowhere else', async () => {
    const service = serviceWith(tasks);
    const listFor = (filter: TaskFilter) => service.listAll({ userId: TEST_USER_ID, filter });

    const [actual, passed, upcoming] = await Promise.all([
      listFor(TaskFilter.ACTUAL), listFor(TaskFilter.PASSED), listFor(TaskFilter.UPCOMING),
    ]);
    const holdsMilk = (list: Task[]) => list.some((task) => task.name === 'buy milk');

    assert.equal(holdsMilk(actual), true);
    assert.equal(holdsMilk(passed), false);
    assert.equal(holdsMilk(upcoming), false);
  });
});

describe('PATCH /tasks/:id/status', () => {
  it('changes the status and leaves everything else alone', async () => {
    const stored = anEvent('gym', 'Mon 2026-08-24', ActiveLogic.THIS_WEEK);
    const service = serviceWith([stored]);

    const updated = await service.updateStatus(stored.id, TEST_USER_ID, TaskStatus.DONE);

    assert.equal(updated.status, TaskStatus.DONE);
    assert.equal(updated.name, 'gym');
    assert.deepEqual(updated.id, stored.id);
  });

  it('rejects an id that matches nothing', async () => {
    await assert.rejects(
      () => serviceWith([]).updateStatus('00000000-0000-4000-8000-000000000000', TEST_USER_ID, TaskStatus.DONE),
      /No task with id/,
    );
  });
});
