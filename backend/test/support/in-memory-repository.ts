import { randomUUID } from 'node:crypto';

import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import type { ITasksRepository, TaskQuery } from '../../src/interfaces/tasks-repository.interface.js';
import type { CreateTask, EventTask, Subtask, Task, UpdateTask } from '../../src/types/tasks.types.js';
import type { RepeatedTask } from '../../src/types/repeated-tasks.types.js';

/** Mirrors `photoOf` in the Mongo repository. */
function photoOf(config: RepeatedTask): { photoUrl?: string } {
  return 'photoUrl' in config ? { photoUrl: config.photoUrl } : {};
}

/** Mirrors `stepsFor` in the Mongo repository: a rewrite keeps the ticks. */
function stepsFor(config: RepeatedTask, existing: Subtask[]): Subtask[] {
  const spare = [...existing];

  return config.subtasks.map((step) => {
    const index = spare.findIndex((done) => done.name === step.name);
    const matched = index === -1 ? undefined : spare[index];
    if (matched === undefined) return { ...step, id: randomUUID(), status: TaskStatus.TODO };

    spare.splice(index, 1);

    return { ...step, id: matched.id, status: matched.status };
  });
}

/**
 * The tasks repository backed by an array instead of a file, so generation can
 * be tested without touching disk. Mirrors the JSON repository's behaviour for
 * the methods the generator uses.
 */
export class InMemoryTasksRepository implements ITasksRepository {
  constructor(private tasks: Task[] = []) {}

  /** Everything currently stored, stamped rows included — for assertions. */
  snapshot(): Task[] {
    return [...this.tasks];
  }

  /**
   * Mirrors the ALIVE clause the Mongo base class puts on every read: a task
   * carrying `deletedAt` is not a result anywhere, so the generator and the
   * services behave in tests exactly as they do against the database.
   */
  private get live(): Task[] {
    return this.tasks.filter((task) => task.deletedAt === null);
  }

  list(userId: string): Promise<Task[]> {
    return Promise.resolve(this.live.filter((task) => task.userId === userId));
  }

  listAcrossUsers(): Promise<Task[]> {
    return Promise.resolve(this.live);
  }

  getById(id: string): Promise<Task | null> {
    return Promise.resolve(this.live.find((task) => task.id === id) ?? null);
  }

  create(input: CreateTask, userId: string): Promise<Task> {
    throw new Error(`not needed by these tests: create(${input.type}) for ${userId}`);
  }

  updateById(id: string, changes: UpdateTask): Promise<Task | null> {
    throw new Error(`not needed by these tests: updateById(${id}, ${changes.type})`);
  }

  softDeleteById(id: string, at: Date): Promise<boolean> {
    return Promise.resolve(this.stamp((task) => task.id === id, at) > 0);
  }

  deleteById(id: string): Promise<boolean> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => task.id !== id);

    return Promise.resolve(this.tasks.length < before);
  }

  /** Stamps every live task the predicate picks; returns how many were hit. */
  private stamp(picks: (task: Task) => boolean, at: Date): number {
    let stamped = 0;
    this.tasks = this.tasks.map((task) => {
      if (task.deletedAt !== null || !picks(task)) return task;
      stamped += 1;

      return { ...task, deletedAt: at };
    });

    return stamped;
  }

  /** Mirrors the Mongo query in TasksRepository.listBy, field for field. */
  listBy(query: TaskQuery): Promise<Task[]> {
    const search = query.search?.toLowerCase();

    return Promise.resolve(this.live.filter((task) => (
      task.userId === query.userId
      && (query.category === undefined || task.category === query.category)
      && (query.type === undefined || task.type === query.type)
      && (query.status === undefined || task.status === query.status)
      && (search === undefined || task.name.toLowerCase().includes(search))
    )));
  }

  createGeneratedEvent(config: RepeatedTask, date: Date): Promise<EventTask> {
    const event: EventTask = {
      id: randomUUID(),
      type: TaskType.EVENT,
      status: TaskStatus.TODO,
      name: config.name,
      userId: config.userId,
      createdAt: date,
      category: config.category,
      links: [...config.links],
      ...photoOf(config),
      remindBeforeMins: config.remindBeforeMins,
      activeBeforeMins: config.activeBeforeMins,
      activeForMins: config.activeForMins,
      subtasks: stepsFor(config, []),
      date,
      passedDate: null,
      notifiedAt: null,
      deletedAt: null,
      configTaskId: config.id,
    };

    this.tasks.push(event);

    return Promise.resolve(event);
  }

  softDeleteManyByIds(ids: string[], userId: string, at: Date): Promise<number> {
    return Promise.resolve(
      this.stamp((task) => ids.includes(task.id) && task.userId === userId, at),
    );
  }

  deleteManyByIds(ids: string[], userId: string): Promise<number> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => !(ids.includes(task.id) && task.userId === userId));

    return Promise.resolve(before - this.tasks.length);
  }

  softDeleteEventsOfConfig(configTaskId: string, at: Date): Promise<number> {
    return Promise.resolve(this.stamp(
      (task) => task.type === TaskType.EVENT && task.configTaskId === configTaskId,
      at,
    ));
  }

  deleteEventsOfConfig(configTaskId: string): Promise<number> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(
      (task) => !(task.type === TaskType.EVENT && task.configTaskId === configTaskId),
    );

    return Promise.resolve(before - this.tasks.length);
  }

  updateStatus(id: string, status: TaskStatus): Promise<Task | null> {
    const index = this.tasks.findIndex((task) => task.id === id && task.deletedAt === null);
    const found = this.tasks[index];
    if (found === undefined) return Promise.resolve(null);

    const updated = { ...found, status };
    this.tasks[index] = updated;

    return Promise.resolve(updated);
  }

  updateSubtaskStatus(
    taskId: string,
    subtaskId: string,
    status: TaskStatus.DONE | TaskStatus.TODO,
  ): Promise<Task | null> {
    const index = this.tasks.findIndex(
      (task) => task.id === taskId && task.deletedAt === null,
    );
    const found = this.tasks[index];
    if (found === undefined || !('subtasks' in found)) return Promise.resolve(null);

    const subtasks = found.subtasks.map((sub) => (sub.id === subtaskId ? { ...sub, status } : sub));
    if (subtasks.every((sub, i) => sub === found.subtasks[i])) return Promise.resolve(null);

    const updated = { ...found, subtasks };
    this.tasks[index] = updated;

    return Promise.resolve(updated);
  }

  applyConfigToEvent(event: EventTask, config: RepeatedTask): Promise<EventTask | null> {
    const index = this.tasks.findIndex(
      (task) => task.id === event.id && task.deletedAt === null,
    );
    const found = this.tasks[index];
    if (found?.type !== TaskType.EVENT) return Promise.resolve(null);

    const rewritten: EventTask = {
      ...found,
      name: config.name,
      category: config.category,
      links: [...config.links],
      remindBeforeMins: config.remindBeforeMins,
      activeBeforeMins: config.activeBeforeMins,
      activeForMins: config.activeForMins,
      subtasks: stepsFor(config, found.subtasks),
    };
    // Mirrors the `$unset` in the Mongo repository: dropping the config's
    // picture drops the occurrence's, rather than leaving the old one behind.
    if ('photoUrl' in config) rewritten.photoUrl = config.photoUrl;
    else delete rewritten.photoUrl;

    this.tasks[index] = rewritten;

    return Promise.resolve(rewritten);
  }

  markNotified(eventId: string, notifiedAt: Date): Promise<EventTask | null> {
    const index = this.tasks.findIndex(
      (task) => task.id === eventId && task.deletedAt === null,
    );
    const found = this.tasks[index];
    if (found?.type !== TaskType.EVENT) return Promise.resolve(null);

    const stamped: EventTask = { ...found, notifiedAt };
    this.tasks[index] = stamped;

    return Promise.resolve(stamped);
  }

  markEventPassed(eventId: string, passedAt: Date): Promise<EventTask | null> {
    const index = this.tasks.findIndex(
      (task) => task.id === eventId && task.deletedAt === null,
    );
    const found = this.tasks[index];
    if (found?.type !== TaskType.EVENT) return Promise.resolve(null);

    const stamped: EventTask = { ...found, passedDate: passedAt };
    this.tasks[index] = stamped;

    return Promise.resolve(stamped);
  }
}
