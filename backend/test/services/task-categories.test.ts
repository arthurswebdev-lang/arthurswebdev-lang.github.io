import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { TaskFilter } from '../../src/enum/task-filter.enum.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import { TasksService } from '../../src/services/tasks.service.js';
import type { Task } from '../../src/types/tasks.types.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import { aBasicTask, anEvent, aWeeklyConfig } from '../support/tasks.js';
import { TEST_USER_ID } from '../support/tasks.js';
import { utc } from '../support/time.js';

const saturday = utc('Sat 2026-08-22 10:00');

function withTasks(stored: Task[]) {
  const repository = new InMemoryTasksRepository(stored);
  const configs = new InMemoryRepeatedTasksRepository([]);
  const generator = new TaskGeneratorService(repository, configs);

  return { repository, configs, generator, service: new TasksService(repository, configs, generator, () => saturday) };
}

const categorised = (name: string, category: TaskCategory): Task =>
  ({ ...aBasicTask(name), category });

describe('listing by category', () => {
  const stored = [
    categorised('buy milk', TaskCategory.FOOD),
    categorised('squats', TaskCategory.GYM),
    categorised('read the docs', TaskCategory.EDUCATION),
    aBasicTask('something else'),
  ];

  it('returns everything when no category is given', async () => {
    const { service } = withTasks(stored);

    assert.equal((await service.listAll({ userId: TEST_USER_ID })).length, 4);
  });

  it('narrows to one category', async () => {
    const { service } = withTasks(stored);

    const gym = await service.listAll({ userId: TEST_USER_ID, category: TaskCategory.GYM });

    assert.deepEqual(gym.map((task) => task.name), ['squats']);
  });

  it('treats an uncategorised task as OTHER, so it is filterable', async () => {
    const { service } = withTasks(stored);

    const other = await service.listAll({ userId: TEST_USER_ID, category: TaskCategory.OTHER });

    assert.deepEqual(other.map((task) => task.name), ['something else']);
  });

});

describe('category and time filters combine', () => {
  const stored = [
    categorised('buy milk', TaskCategory.FOOD),
    categorised('squats', TaskCategory.GYM),
  ];

  it('combines with the time filter', async () => {
    const { service } = withTasks([
      ...stored,
      { ...anEvent('gym session', 'Mon 2026-08-24 09:00'), category: TaskCategory.GYM },
    ]);

    assert.deepEqual(
      (await service.listAll({ userId: TEST_USER_ID, filter: TaskFilter.UPCOMING, category: TaskCategory.GYM })).map((task) => task.name),
      ['gym session'],
    );
    assert.deepEqual(await service.listAll({ userId: TEST_USER_ID, filter: TaskFilter.PASSED, category: TaskCategory.GYM }), []);
  });

});

describe('filters and dateless tasks', () => {
  const stored = [
    categorised('buy milk', TaskCategory.FOOD),
    categorised('squats', TaskCategory.GYM),
  ];

  it('shows dateless tasks under actual, so a plain to-do is never hidden', async () => {
    const { service } = withTasks(stored);
    const query = { userId: TEST_USER_ID, category: TaskCategory.FOOD };

    assert.equal((await service.listAll({ ...query, filter: TaskFilter.ACTUAL })).length, 1);
    assert.equal((await service.listAll({ ...query, filter: TaskFilter.PASSED })).length, 0);
    assert.equal((await service.listAll(query)).length, 1);
  });
});

describe('a generated event inherits from its config', () => {
  it('takes the category and links, since it cannot be edited later', async () => {
    const { configs, generator, repository } = withTasks([]);
    const config = aWeeklyConfig('standup', [1], {
      category: TaskCategory.WORK,
      links: ['https://meet.example.com/standup'],
    });
    await configs.create(config, TEST_USER_ID);

    const event = await generator.ensurePendingEvent(config, saturday);

    assert.ok(event !== null);
    assert.equal(event.category, TaskCategory.WORK);
    assert.deepEqual(event.links, ['https://meet.example.com/standup']);
    assert.equal(repository.snapshot().length, 1);
  });

  it('copies the links rather than sharing the array', async () => {
    const { configs, generator } = withTasks([]);
    const config = aWeeklyConfig('standup', [1], { links: ['https://meet.example.com/a'] });
    await configs.create(config, TEST_USER_ID);

    const event = await generator.ensurePendingEvent(config, saturday);
    config.links.push('https://meet.example.com/b');

    assert.deepEqual(event?.links, ['https://meet.example.com/a']);
  });
});
