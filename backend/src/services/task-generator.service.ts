import {
  eventsOfConfig, isEventTask, isPassedEvent, pendingEventOfConfig,
} from '../filters/tasks.filters.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import { nextOccurrence } from '../generators/occurrences.generator.js';
import type {
  IRepeatedTasksRepository,
} from '../interfaces/repeated-tasks-repository.interface.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { EventTask } from '../types/tasks.types.js';
import type { RepeatedTask } from '../types/repeated-tasks.types.js';

/**
 * Keeps the stored tasks in step with what the configs imply: every config has
 * one event waiting on it, and events whose moment has gone by are stamped as
 * passed.
 *
 * Deliberately generates **one occurrence at a time** (B4). After downtime the
 * next pass creates the next occurrence from now and nothing else — a weekend
 * offline does not produce a wall of already-missed reminders.
 */
export class TaskGeneratorService implements ITaskGeneratorService {
  constructor(
    private readonly tasksRepository: ITasksRepository,
    private readonly repeatedTasksRepository: IRepeatedTasksRepository,
  ) {}

  async markPassedEvents(now: Date): Promise<EventTask[]> {
    const tasks = await this.tasksRepository.listAcrossUsers();
    const newlyPassed = tasks
      .filter(isEventTask)
      .filter((event) => event.passedDate === null && event.date <= now);

    const stamped = await Promise.all(
      newlyPassed.map((event) => this.tasksRepository.markEventPassed(event.id, now)),
    );

    return stamped.filter((event): event is EventTask => event !== null);
  }

  async ensurePendingEvent(config: RepeatedTask, now: Date): Promise<EventTask | null> {
    const tasks = await this.tasksRepository.listBy({ userId: config.userId });
    if (pendingEventOfConfig(tasks, config.id, now) !== null) return null;

    return this.generateNextFrom(config, now);
  }

  async syncPendingEvents(now: Date): Promise<EventTask[]> {
    // One read of each store, then one decision per config against that single
    // snapshot. This is why the work can run in parallel: nothing re-reads
    // mid-way, so no config decides against a store another has already
    // changed. The writes themselves are serialised by the repository queue.
    const [tasks, configs] = await Promise.all([
      this.tasksRepository.listAcrossUsers(),
      this.repeatedTasksRepository.listAcrossUsers(),
    ]);

    const needingEvent = configs
      .filter((config) => pendingEventOfConfig(tasks, config.id, now) === null);

    const generated = await Promise.all(
      needingEvent.map((config) => this.generateNextFrom(config, now)),
    );

    return generated.filter((event): event is EventTask => event !== null);
  }

  async regenerateForConfig(config: RepeatedTask, now: Date): Promise<EventTask | null> {
    await this.tasksRepository.deleteEventsOfConfig(config.id);

    return this.generateNextFrom(config, now);
  }

  async generateNextAfter(event: EventTask, now: Date): Promise<EventTask | null> {
    if (event.configTaskId === null) return null;

    const config = await this.repeatedTasksRepository.getById(event.configTaskId);
    if (config === null) return null;

    // The poller may already have moved this config on. Finishing an event that
    // had *already* passed means `syncPendingEvents` generated its successor on
    // some tick in between, and generating a second one here is what put two
    // identical occurrences in the list.
    //
    // The check cannot simply be `pendingEventOfConfig`, because finishing
    // early — the case this method exists for — leaves the event being finished
    // sitting there unpassed and would block its own successor. So the event in
    // hand is excluded, and a finished one never counts as still waiting.
    const tasks = await this.tasksRepository.listBy({ userId: config.userId });
    const successor = eventsOfConfig(tasks, config.id).find((other) => (
      other.id !== event.id
      && other.status !== TaskStatus.DONE
      && !isPassedEvent(other, now)
    ));
    if (successor !== undefined) return null;

    // Measured from the finished event's own date when that is still ahead, so
    // finishing early yields the *following* occurrence, not the same one again.
    const from = event.date > now ? event.date : now;

    return this.generateNextFrom(config, from);
  }

  /** The one place an occurrence is turned into a stored event. */
  private async generateNextFrom(config: RepeatedTask, after: Date): Promise<EventTask | null> {
    const date = nextOccurrence(config, after);
    if (date === null) return null;

    return this.tasksRepository.createGeneratedEvent(config, date);
  }
}
