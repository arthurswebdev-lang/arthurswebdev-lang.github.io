import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { isEventTask } from '../../src/filters/tasks.filters.js';
import { EventPollingService } from '../../src/services/event-polling.service.js';
import { TaskGeneratorService } from '../../src/services/task-generator.service.js';
import type { INotificationService } from '../../src/interfaces/notification-service.interface.js';
import type { EventTask, Task } from '../../src/types/tasks.types.js';
import { InMemoryRepeatedTasksRepository } from '../support/in-memory-repeated-repository.js';
import { InMemoryTasksRepository } from '../support/in-memory-repository.js';
import { anEvent, hours } from '../support/tasks.js';
import { utc } from '../support/time.js';

/** Records what was announced, so a test can assert on names alone. */
class RecordingNotifications implements INotificationService {
  readonly sent: string[] = [];

  notify(task: EventTask): Promise<void> {
    this.sent.push(task.name);

    return Promise.resolve();
  }

  announce(): Promise<void> {
    return Promise.resolve();
  }
}

const POLL_MS = 60_000;

function pollerOver(tasks: Task[]) {
  const repository = new InMemoryTasksRepository(tasks);
  const configs = new InMemoryRepeatedTasksRepository([]);
  const generator = new TaskGeneratorService(repository, configs);
  const notifications = new RecordingNotifications();

  return {
    repository,
    notifications,
    poller: new EventPollingService(repository, notifications, generator, POLL_MS),
  };
}

const stampOf = (repository: InMemoryTasksRepository, name: string) =>
  repository.snapshot().filter(isEventTask).find((event) => event.name === name)?.notifiedAt ?? null;

/** The interview: reminded ten minutes before a 15:00 start, spent at 18:00. */
const interview = () => anEvent('interview', 'Fri 2026-09-04 15:00', {
  remindBeforeMins: 10,
  activeBeforeMins: hours(1),
  activeForMins: hours(3),
});

describe('the reminder fires at remindAt, not at the date', () => {
  it('stays quiet a minute before the reminder is due', async () => {
    const { poller, notifications } = pollerOver([interview()]);

    await poller.tick(utc('Fri 2026-09-04 14:49'));

    assert.deepEqual(notifications.sent, []);
  });

  it('announces ten minutes ahead of the event itself', async () => {
    const { poller, notifications } = pollerOver([interview()]);

    await poller.tick(utc('Fri 2026-09-04 14:50'));

    assert.deepEqual(notifications.sent, ['interview']);
  });

  it('stamps notifiedAt with the pass that sent it', async () => {
    const { poller, repository } = pollerOver([interview()]);
    const at = utc('Fri 2026-09-04 14:50');

    await poller.tick(at);

    assert.deepEqual(stampOf(repository, 'interview'), at);
  });
});

describe('an event is announced once and only once', () => {
  it('does not announce again on the next pass', async () => {
    const { poller, notifications } = pollerOver([interview()]);

    await poller.tick(utc('Fri 2026-09-04 14:50'));
    await poller.tick(utc('Fri 2026-09-04 14:51'));
    await poller.tick(utc('Fri 2026-09-04 15:00'));

    assert.deepEqual(notifications.sent, ['interview']);
  });

  it('survives a restart, because the stamp is on the event and not in memory', async () => {
    const { poller, repository, notifications } = pollerOver([interview()]);
    await poller.tick(utc('Fri 2026-09-04 14:50'));

    // A brand new service over the same store: this is what a fly deploy does.
    const restarted = new EventPollingService(
      repository,
      notifications,
      new TaskGeneratorService(repository, new InMemoryRepeatedTasksRepository([])),
      POLL_MS,
    );
    await restarted.tick(utc('Fri 2026-09-04 14:55'));

    assert.deepEqual(notifications.sent, ['interview']);
  });
});

describe('a reminder missed while the machine was down', () => {
  it('is still announced once the machine is back', async () => {
    // The regression that made the stamp necessary: the old poller held its
    // window in memory, so an event that came due while the machine was down
    // was never announced at all — not late, never.
    const { repository, notifications } = pollerOver([interview()]);
    const fresh = new EventPollingService(
      repository,
      notifications,
      new TaskGeneratorService(repository, new InMemoryRepeatedTasksRepository([])),
      POLL_MS,
    );

    await fresh.tick(utc('Fri 2026-09-04 15:30'));

    assert.deepEqual(notifications.sent, ['interview']);
  });
});

describe('what the poller declines to announce', () => {
  it('skips an event already marked done', async () => {
    const done = anEvent('interview', 'Fri 2026-09-04 15:00', { status: TaskStatus.DONE });
    const { poller, notifications } = pollerOver([done]);

    await poller.tick(utc('Fri 2026-09-04 15:00'));

    assert.deepEqual(notifications.sent, []);
  });

  it('skips one whose window has already closed', async () => {
    // A machine down for a day must not wake up and announce yesterday's
    // reminders as though they were news.
    const { poller, notifications } = pollerOver([interview()]);

    await poller.tick(utc('Sat 2026-09-05 09:00'));

    assert.deepEqual(notifications.sent, []);
  });

  it('announces one whose reminder was already past when it was created', async () => {
    // A repeat shorter than its own lead time produces this: the occurrence is
    // created with a remindAt behind it. The old in-memory window silently
    // dropped it for ever; asking the event resolves it on the next pass.
    const late = anEvent('water', '2026-08-19 13:00', {
      remindBeforeMins: hours(3),
      activeBeforeMins: hours(3),
      activeForMins: hours(2),
    });
    const { poller, notifications } = pollerOver([late]);

    await poller.tick(utc('2026-08-19 12:30'));

    assert.deepEqual(notifications.sent, ['water']);
  });
});
