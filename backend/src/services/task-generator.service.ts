import { isEventTask, pendingEventOfConfig } from '../filters/tasks.filters.js';
import { nextOccurrence } from '../generators/occurrences.generator.js';
import type {
  IRepeatedTasksRepository,
} from '../interfaces/repeated-tasks-repository.interface.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { EventTask, RepeatedTask } from '../types/tasks.types.js';

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
    const tasks = await this.tasksRepository.list();
    const newlyPassed = tasks
      .filter(isEventTask)
      .filter((event) => event.passedDate === null && event.date <= now);

    const stamped = await Promise.all(
      newlyPassed.map((event) => this.tasksRepository.markEventPassed(event.id, now)),
    );

    return stamped.filter((event): event is EventTask => event !== null);
  }

  async ensurePendingEvent(config: RepeatedTask, now: Date): Promise<EventTask | null> {
    const tasks = await this.tasksRepository.list();
    if (pendingEventOfConfig(tasks, config.id, now) !== null) return null;

    return this.generateNextFrom(config, now);
  }

  async syncPendingEvents(now: Date): Promise<EventTask[]> {
    // One read of each store, then one decision per config against that single
    // snapshot. This is why the work can run in parallel: nothing re-reads
    // mid-way, so no config decides against a store another has already
    // changed. The writes themselves are serialised by the repository queue.
    const [tasks, configs] = await Promise.all([
      this.tasksRepository.list(),
      this.repeatedTasksRepository.list(),
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
