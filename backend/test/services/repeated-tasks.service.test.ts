import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import { isEventTask } from '../../src/filters/tasks.filters.js';
import { RepeatedTasksService } from '../../src/services/repeated-tasks.service.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import type { EventTask } from '../../src/types/tasks.types.js';
import type { CreateWeeklyTask } from '../../src/types/repeated-tasks.types.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import { TEST_USER_ID } from '../support/tasks.js';

/**
 * The rule these tests exist for: editing a repeat regenerates its occurrences
 * only when the *schedule* moves. Everything else is written onto the ones
 * already waiting, and nothing that has been done is ever thrown away.
 */
function serviceWith() {
  const tasks = new InMemoryTasksRepository([]);
  const configs = new InMemoryRepeatedTasksRepository([]);
  const generator = new TaskGeneratorService(tasks, configs);

  return {
    tasks,
    service: new RepeatedTasksService(configs, tasks, generator),
  };
}

const gymBody: CreateWeeklyTask = {
  type: TaskType.REPEATED_WEEKLY,
  name: 'Leg press – 70kg',
  weekdays: [1, 4],
  subtasks: [{ name: 'Warm-up ×12' }, { name: 'Set 1 ×12' }],
};

const eventsIn = (tasks: InMemoryTasksRepository): EventTask[] =>
  tasks.snapshot().filter(isEventTask);

describe('patching a repeat without moving its schedule', () => {
  it('keeps the waiting occurrence, id and date intact', async () => {
    const { tasks, service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);
    const before = eventsIn(tasks)[0];
    assert.ok(before !== undefined);

    await service.patchById(config.id, TEST_USER_ID, { name: 'Leg press – 80kg' });

    const after = eventsIn(tasks);
    assert.equal(after.length, 1);
    const only = after[0];
    assert.ok(only !== undefined);
    assert.equal(only.id, before.id);
    assert.deepEqual(only.date, before.date);
  });

  it('pushes the new name onto it', async () => {
    const { tasks, service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);

    await service.patchById(config.id, TEST_USER_ID, { name: 'Leg press – 80kg' });

    assert.equal(eventsIn(tasks)[0]?.name, 'Leg press – 80kg');
  });
});

describe('a patch propagates the fields it changed', () => {
  it('pushes new steps onto it', async () => {
    const { tasks, service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);

    await service.patchById(config.id, TEST_USER_ID, {
      subtasks: [{ name: 'Warm-up ×12' }, { name: 'Set 1 ×12' }, { name: 'Set 2 ×12' }],
    });

    assert.equal(eventsIn(tasks)[0]?.subtasks.length, 3);
  });

  it('leaves every field it did not name alone', async () => {
    const { service } = serviceWith();
    const config = await service.create({ ...gymBody, activeForMins: 600 }, TEST_USER_ID);

    const patched = await service.patchById(config.id, TEST_USER_ID, { name: 'Renamed' });

    assert.equal(patched.activeForMins, 600);
    assert.deepEqual(patched.subtasks.map((step) => step.name), ['Warm-up ×12', 'Set 1 ×12']);
    assert.equal(patched.name, 'Renamed');
  });
});

describe('patching a repeat that does move its schedule', () => {
  it('replaces the waiting occurrence, because its date no longer follows', async () => {
    const { tasks, service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);
    const before = eventsIn(tasks)[0];
    assert.ok(before !== undefined);

    await service.patchById(config.id, TEST_USER_ID, { weekdays: [2, 5] });

    const after = eventsIn(tasks);
    assert.equal(after.length, 1);
    assert.notEqual(after[0]?.id, before.id);
  });

  it('does not count a reordered weekday list as a move', async () => {
    const { tasks, service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);
    const before = eventsIn(tasks)[0];

    await service.patchById(config.id, TEST_USER_ID, { weekdays: [4, 1] });

    assert.equal(eventsIn(tasks)[0]?.id, before?.id);
  });
});

describe('a patch never destroys what was done', () => {
  it('keeps a finished occurrence when the schedule moves', async () => {
    const { tasks, service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);
    const done = eventsIn(tasks)[0];
    assert.ok(done !== undefined);
    await tasks.updateStatus(done.id, TaskStatus.DONE);

    await service.patchById(config.id, TEST_USER_ID, { weekdays: [2, 5] });

    const kept = eventsIn(tasks).find((event) => event.id === done.id);
    assert.equal(kept?.status, TaskStatus.DONE);
  });

});

describe('a finished occurrence does not block the next one', () => {
  it('still produces the next occurrence when the finished one is dated ahead', async () => {
    // Finishing early leaves a DONE occurrence in the future. It is a record of
    // something done, not something waiting, so it must not block the new
    // schedule from generating — which is exactly what it used to do.
    const { tasks, service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);
    const done = eventsIn(tasks)[0];
    assert.ok(done !== undefined);
    await tasks.updateStatus(done.id, TaskStatus.DONE);

    await service.patchById(config.id, TEST_USER_ID, { weekdays: [2, 5] });

    const waiting = eventsIn(tasks).filter((event) => event.status !== TaskStatus.DONE);
    assert.equal(waiting.length, 1);
    assert.notEqual(waiting[0]?.id, done.id);
  });

  it('leaves a finished occurrence under the old name after a rename', async () => {
    const { tasks, service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);
    const done = eventsIn(tasks)[0];
    assert.ok(done !== undefined);
    await tasks.updateStatus(done.id, TaskStatus.DONE);

    await service.patchById(config.id, TEST_USER_ID, { name: 'Leg press – 80kg' });

    const kept = eventsIn(tasks).find((event) => event.id === done.id);
    assert.equal(kept?.name, 'Leg press – 70kg');
  });
});

describe('what a patch refuses', () => {
  it('rejects a field that belongs to another schedule', async () => {
    const { service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);

    await assert.rejects(
      () => service.patchById(config.id, TEST_USER_ID, { fromDay: 5 }),
      /fromDay/,
    );
  });

  it('rejects a reminder that would arrive before the task is visible', async () => {
    const { service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);

    await assert.rejects(
      () => service.patchById(config.id, TEST_USER_ID, { remindBeforeMins: 60 * 24 * 30 }),
      /still hidden under upcoming/,
    );
  });
});

describe('a patch on something that is not yours', () => {
  it('rejects an unknown id as missing', async () => {
    const { service } = serviceWith();

    await assert.rejects(
      () => service.patchById('nope', TEST_USER_ID, { name: 'x' }),
      /No repeated task with id/,
    );
  });

  it('rejects another owner\'s config as missing', async () => {
    const { service } = serviceWith();
    const config = await service.create(gymBody, TEST_USER_ID);

    await assert.rejects(
      () => service.patchById(config.id, 'someone-else', { name: 'x' }),
      /No repeated task with id/,
    );
  });
});
