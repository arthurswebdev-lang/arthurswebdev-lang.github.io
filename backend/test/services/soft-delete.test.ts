import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { RepeatedTasksService } from '../../src/services/repeated-tasks.service.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import { TasksService } from '../../src/services/tasks.service.js';
import type { RepeatedTask } from '../../src/types/repeated-tasks.types.js';
import type { Task } from '../../src/types/tasks.types.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import {
  aBasicTask, aDailyConfig, aHandMadeEvent, anEvent, TEST_USER_ID, timeOfDay,
} from '../support/tasks.js';
import { utc } from '../support/time.js';

const now = utc('Sat 2026-08-22 10:00');

/**
 * Both services over the same pair of stores, because deleting reaches across
 * them: a repeat and the occurrences it made have to go, and come back,
 * together.
 */
function servicesWith(stored: Task[], configs: RepeatedTask[] = []) {
  const tasks = new InMemoryTasksRepository(stored);
  const rules = new InMemoryRepeatedTasksRepository(configs);
  const generator = new TaskGeneratorService(tasks, rules);

  return {
    tasks,
    rules,
    service: new TasksService(tasks, rules, generator, () => now),
    repeats: new RepeatedTasksService(rules, tasks, generator),
  };
}

describe('DELETE /tasks/:id', () => {
  it('stamps the task rather than removing it', async () => {
    const stored = aBasicTask('buy milk');
    const { service, tasks } = servicesWith([stored]);

    await service.deleteById(stored.id, TEST_USER_ID);

    assert.equal(tasks.snapshot().length, 1, 'the row is still there');
    assert.deepEqual(tasks.snapshot()[0]?.deletedAt, now, 'stamped at the delete');
  });

  it('takes the task out of every list', async () => {
    const { service } = servicesWith([aBasicTask('buy milk'), aBasicTask('pay rent')]);
    const [gone] = await service.listAll({ userId: TEST_USER_ID });
    assert.ok(gone !== undefined);

    await service.deleteById(gone.id, TEST_USER_ID);

    const left = await service.listAll({ userId: TEST_USER_ID });
    assert.deepEqual(left.map((task) => task.name), ['pay rent']);
  });

});

/* A stamped row is unreachable, not merely missing from the list: nothing above
   the repository can read it, write to it, or delete it a second time. */
describe('a task that has been deleted', () => {
  it('cannot be read, changed or deleted again', async () => {
    const stored = aBasicTask('buy milk');
    const { service } = servicesWith([stored]);
    await service.deleteById(stored.id, TEST_USER_ID);

    assert.equal(await service.getById(stored.id, TEST_USER_ID), null);
    await assert.rejects(
      () => service.updateStatus(stored.id, TEST_USER_ID, TaskStatus.DONE),
      /No task with id/,
    );
    await assert.rejects(() => service.deleteById(stored.id, TEST_USER_ID), /No task with id/);
  });
});

describe('DELETE /tasks/:id?permanent=true', () => {
  it('removes the row outright', async () => {
    const stored = aHandMadeEvent('dentist', 'Mon 2026-08-24 09:00');
    const { service, tasks } = servicesWith([stored]);

    await service.deleteById(stored.id, TEST_USER_ID, true);

    assert.deepEqual(tasks.snapshot(), [], 'nothing left to restore');
  });
});

/* Deleting one occurrence of a repeat means deleting the rule — otherwise the
   next poll puts the occurrence straight back. Both have to carry the stamp,
   or a restore would bring back half of it. */
describe('deleting a generated event', () => {
  const config = aDailyConfig('push-ups', { timesOfDay: [timeOfDay('09:00')] });
  const occurrence = anEvent('push-ups', 'Sat 2026-08-22 09:00', { configTaskId: config.id });

  it('stamps the rule and its occurrences together', async () => {
    const { service, tasks, rules } = servicesWith([occurrence], [config]);

    await service.deleteById(occurrence.id, TEST_USER_ID);

    assert.deepEqual(tasks.snapshot()[0]?.deletedAt, now);
    assert.deepEqual(rules.snapshot()[0]?.deletedAt, now, 'one instant for both');
    assert.deepEqual(await rules.list(TEST_USER_ID), [], 'and the rule is out of the list');
  });

  it('leaves nothing behind when permanent is asked for', async () => {
    const { service, tasks, rules } = servicesWith([occurrence], [config]);

    await service.deleteById(occurrence.id, TEST_USER_ID, true);

    assert.deepEqual(tasks.snapshot(), []);
    assert.deepEqual(rules.snapshot(), []);
  });
});

describe('DELETE /repeated-tasks/:id', () => {
  const config = aDailyConfig('push-ups', { timesOfDay: [timeOfDay('09:00')] });
  const occurrence = anEvent('push-ups', 'Sat 2026-08-22 09:00', { configTaskId: config.id });

  it('stamps the config and every event it made', async () => {
    const { repeats, tasks, rules } = servicesWith([occurrence], [config]);

    await repeats.deleteById(config.id, TEST_USER_ID);

    assert.notEqual(rules.snapshot()[0]?.deletedAt, null);
    assert.notEqual(tasks.snapshot()[0]?.deletedAt, null);
  });

  it('removes both outright when permanent is asked for', async () => {
    const { repeats, tasks, rules } = servicesWith([occurrence], [config]);

    await repeats.deleteById(config.id, TEST_USER_ID, true);

    assert.deepEqual(rules.snapshot(), []);
    assert.deepEqual(tasks.snapshot(), []);
  });
});

/* The poller is the one thing that could undo a delete: it tops up any config
   with nothing pending. A stamped config is not a config it can see. */
describe('the poller and stamped rows', () => {
  it('does not generate for a deleted config', async () => {
    const config = aDailyConfig('push-ups', { timesOfDay: [timeOfDay('09:00')] });
    const tasks = new InMemoryTasksRepository([]);
    const rules = new InMemoryRepeatedTasksRepository([{ ...config, deletedAt: now }]);
    const generator = new TaskGeneratorService(tasks, rules);

    const made = await generator.syncPendingEvents(now);

    assert.deepEqual(made, []);
    assert.deepEqual(tasks.snapshot(), []);
  });

  it('does not count a deleted occurrence as the one already pending', async () => {
    const config = aDailyConfig('push-ups', { timesOfDay: [timeOfDay('09:00')] });
    const stamped = anEvent('push-ups', 'Sun 2026-08-23 09:00', {
      configTaskId: config.id, deletedAt: now,
    });
    const tasks = new InMemoryTasksRepository([stamped]);
    const rules = new InMemoryRepeatedTasksRepository([config]);
    const generator = new TaskGeneratorService(tasks, rules);

    const made = await generator.syncPendingEvents(now);

    assert.equal(made.length, 1, 'a fresh occurrence, not the stamped one');
    assert.notEqual(made[0]?.id, stamped.id);
  });
});
