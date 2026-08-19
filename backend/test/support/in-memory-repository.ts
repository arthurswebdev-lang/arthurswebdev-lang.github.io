import { randomUUID } from 'node:crypto';

import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import { activeLogicForRepeatedTask } from '../../src/filters/tasks.filters.js';
import type { ITasksRepository, TaskQuery } from '../../src/interfaces/tasks-repository.interface.js';
import type { CreateTask, EventTask, Task, UpdateTask } from '../../src/types/tasks.types.js';
import type { RepeatedTask } from '../../src/types/repeated-tasks.types.js';

/**
 * The tasks repository backed by an array instead of a file, so generation can
 * be tested without touching disk. Mirrors the JSON repository's behaviour for
 * the methods the generator uses.
 */
export class InMemoryTasksRepository implements ITasksRepository {
  constructor(private tasks: Task[] = []) {}

  /** Everything currently stored — for assertions. */
  snapshot(): Task[] {
    return [...this.tasks];
  }

  list(userId: string): Promise<Task[]> {
    return Promise.resolve(this.tasks.filter((task) => task.userId === userId));
  }

  listAcrossUsers(): Promise<Task[]> {
    return Promise.resolve([...this.tasks]);
  }

  getById(id: string): Promise<Task | null> {
    return Promise.resolve(this.tasks.find((task) => task.id === id) ?? null);
  }

  create(input: CreateTask, userId: string): Promise<Task> {
    throw new Error(`not needed by these tests: create(${input.type}) for ${userId}`);
  }

  updateById(id: string, changes: UpdateTask): Promise<Task | null> {
    throw new Error(`not needed by these tests: updateById(${id}, ${changes.type})`);
  }

  deleteById(id: string): Promise<boolean> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => task.id !== id);

    return Promise.resolve(this.tasks.length < before);
  }

  /** Mirrors the Mongo query in TasksRepository.listBy, field for field. */
  listBy(query: TaskQuery): Promise<Task[]> {
    const search = query.search?.toLowerCase();

    return Promise.resolve(this.tasks.filter((task) => (
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
      subtasks: [],
      date,
      activeLogic: activeLogicForRepeatedTask(config),
      passedDate: null,
      configTaskId: config.id,
    };

    this.tasks.push(event);

    return Promise.resolve(event);
  }

  deleteEventsOfConfig(configTaskId: string): Promise<number> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(
      (task) => !(task.type === TaskType.EVENT && task.configTaskId === configTaskId),
    );

    return Promise.resolve(before - this.tasks.length);
  }

  updateStatus(id: string, status: TaskStatus): Promise<Task | null> {
    const index = this.tasks.findIndex((task) => task.id === id);
    const found = this.tasks[index];
    if (found === undefined) return Promise.resolve(null);

    const updated = { ...found, status };
    this.tasks[index] = updated;

    return Promise.resolve(updated);
  }

  markEventPassed(eventId: string, passedAt: Date): Promise<EventTask | null> {
    const index = this.tasks.findIndex((task) => task.id === eventId);
    const found = this.tasks[index];
    if (found?.type !== TaskType.EVENT) return Promise.resolve(null);

    const stamped: EventTask = { ...found, passedDate: passedAt };
    this.tasks[index] = stamped;

    return Promise.resolve(stamped);
  }
}
