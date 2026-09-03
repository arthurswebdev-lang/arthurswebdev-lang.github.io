import { randomUUID } from 'node:crypto';

import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import { ALL_WEEKDAYS, windowWithDefaults } from '../../src/schemes/common.schemes.js';

import type {
  IRepeatedTasksRepository,
} from '../../src/interfaces/repeated-tasks-repository.interface.js';
import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../../src/types/repeated-tasks.types.js';

function toEntity(input: CreateRepeatedTask, userId: string): RepeatedTask {
  const base = {
    id: randomUUID(),
    userId,
    createdAt: new Date(),
    category: input.category ?? TaskCategory.OTHER,
    links: input.links ?? [],
    ...windowWithDefaults(input),
    subtasks: (input.subtasks ?? []).map((step) => ({ ...step, id: randomUUID() })),
  };

  if (input.type === TaskType.REPEATED_DAILY) {
    return { ...input, ...base, weekdays: input.weekdays ?? ALL_WEEKDAYS };
  }

  return { ...input, ...base };
}

/** The configs store, backed by an array. */
export class InMemoryRepeatedTasksRepository implements IRepeatedTasksRepository {
  constructor(private configs: RepeatedTask[] = []) {}

  list(userId: string): Promise<RepeatedTask[]> {
    return Promise.resolve(this.configs.filter((config) => config.userId === userId));
  }

  listAcrossUsers(): Promise<RepeatedTask[]> {
    return Promise.resolve([...this.configs]);
  }

  listByIds(ids: string[]): Promise<RepeatedTask[]> {
    return Promise.resolve(this.configs.filter((config) => ids.includes(config.id)));
  }

  getById(id: string): Promise<RepeatedTask | null> {
    return Promise.resolve(this.configs.find((config) => config.id === id) ?? null);
  }

  create(input: CreateRepeatedTask, userId: string): Promise<RepeatedTask> {
    const config = toEntity(input, userId);
    this.configs.push(config);

    return Promise.resolve(config);
  }

  updateById(id: string, changes: UpdateRepeatedTask): Promise<RepeatedTask | null> {
    const index = this.configs.findIndex((config) => config.id === id);
    const found = this.configs[index];
    if (found === undefined) return Promise.resolve(null);

    // Through `toEntity`, like the real repository: an update is a replacement,
    // so its step drafts have to become steps rather than being spread in raw.
    const updated = {
      ...toEntity(changes, found.userId),
      id: found.id,
      createdAt: found.createdAt,
    };
    this.configs[index] = updated;

    return Promise.resolve(updated);
  }

  deleteById(id: string): Promise<boolean> {
    const before = this.configs.length;
    this.configs = this.configs.filter((config) => config.id !== id);

    return Promise.resolve(this.configs.length < before);
  }
}
