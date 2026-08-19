import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';

import { type Db, MongoClient } from 'mongodb';

import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import { TasksRepository } from '../../src/repositories/tasks.repository.js';
import type { CreateTask, EventTask } from '../../src/types/tasks.types.js';
import { aWeeklyConfig } from '../support/tasks.js';
import { utc } from '../support/time.js';

const MONGO_URL = process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27017';

/**
 * These exercise the real driver, so they need a Mongo to talk to. When there
 * is none the suite skips rather than fails: the rest of the tests are pure
 * and must stay runnable on a machine without a database.
 */
const client = await MongoClient.connect(MONGO_URL, { serverSelectionTimeoutMS: 1500 })
  .catch(() => null);

const mongoUnavailable = client === null;
const databases: Db[] = [];

function freshRepository(): TasksRepository {
  assert.ok(client !== null);

  // A throwaway database per test, so nothing leaks between them.
  const db = client.db(`tasks-api-test-${randomUUID()}`);
  databases.push(db);

  return new TasksRepository(db);
}

after(async () => {
  await Promise.all(databases.map((db) => db.dropDatabase()));
  await client?.close();
});

const anEventPayload = (name: string): CreateTask => ({
  type: TaskType.EVENT,
  name,
  date: utc('2026-08-19 13:00'),
  subtasks: [],
});

describe('PUT keeps hold of what the server owns', { skip: mongoUnavailable }, () => {
  it('preserves configTaskId, so a generated event stays linked to its config', async () => {
    const repository = freshRepository();
    const config = aWeeklyConfig('gym', [1, 5]);
    const generated = await repository.createGeneratedEvent(config, utc('2026-08-24 09:00'));

    const updated = await repository.updateById(generated.id, {
      type: TaskType.EVENT,
      name: 'gym',
      status: TaskStatus.DONE,
      date: utc('2026-08-24 09:00'),
    });

    assert.ok(updated !== null && updated.type === TaskType.EVENT);
    assert.equal(updated.configTaskId, config.id);
    assert.equal(updated.status, TaskStatus.DONE);
  });
});

describe('PUT keeps a passed event passed', { skip: mongoUnavailable }, () => {
  it('preserves passedDate, so a passed event does not look pending again', async () => {
    const repository = freshRepository();
    const config = aWeeklyConfig('gym', [1]);
    const generated = await repository.createGeneratedEvent(config, utc('2026-08-24 09:00'));
    await repository.markEventPassed(generated.id, utc('2026-08-24 09:01'));

    const updated = await repository.updateById(generated.id, {
      type: TaskType.EVENT,
      name: 'gym',
      date: utc('2026-08-24 09:00'),
    });

    assert.ok(updated !== null && updated.type === TaskType.EVENT);
    assert.deepEqual(updated.passedDate, utc('2026-08-24 09:01'));
  });
});

describe('PUT still preserves identity', { skip: mongoUnavailable }, () => {
  it('still preserves id and createdAt', async () => {
    const repository = freshRepository();
    const created = await repository.create(anEventPayload('dentist'));

    const updated = await repository.updateById(created.id, {
      type: TaskType.EVENT,
      name: 'dentist renamed',
      date: utc('2026-08-19 13:00'),
    });

    assert.ok(updated !== null);
    assert.equal(updated.id, created.id);
    assert.deepEqual(updated.createdAt, created.createdAt);
    assert.equal(updated.name, 'dentist renamed');
  });
});

describe('events belonging to a config', { skip: mongoUnavailable }, () => {
  it('deletes every event a config produced', async () => {
    const repository = freshRepository();
    const config = aWeeklyConfig('gym', [1, 5]);
    await repository.createGeneratedEvent(config, utc('2026-08-24 09:00'));
    await repository.createGeneratedEvent(config, utc('2026-08-28 09:00'));
    await repository.create(anEventPayload('unrelated'));

    const removed = await repository.deleteEventsOfConfig(config.id);
    const left = await repository.list();

    assert.equal(removed, 2);
    assert.deepEqual(left.map((task) => task.name), ['unrelated']);
  });

  it('survives a round trip through the driver, dates included', async () => {
    const repository = freshRepository();
    const config = aWeeklyConfig('gym', [1]);
    const generated = await repository.createGeneratedEvent(config, utc('2026-08-24 09:00'));
    await repository.markEventPassed(generated.id, utc('2026-08-24 09:01'));

    const reread: EventTask | null = await repository.getById(generated.id) as EventTask | null;

    assert.ok(reread !== null);
    assert.ok(reread.date instanceof Date);
    assert.ok(reread.passedDate instanceof Date);
    assert.equal(reread.configTaskId, config.id);
  });
});
