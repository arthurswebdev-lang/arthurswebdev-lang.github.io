import { randomUUID } from 'node:crypto';

import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { DEFAULT_ACTIVE_FOR_MINS } from '../../src/schemes/common.schemes.js';

import type {
  IRepeatedTasksRepository,
} from '../../src/interfaces/repeated-tasks-repository.interface.js';
import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../../src/types/repeated-tasks.types.js';

function toEntity(input: CreateRepeatedTask, userId: string): RepeatedTask {
  return {
    ...input,
    id: randomUUID(),
    userId,
    createdAt: new Date(),
    category: input.category ?? TaskCategory.OTHER,
    links: input.links ?? [],
    activeForMins: input.activeForMins ?? DEFAULT_ACTIVE_FOR_MINS,
    subtasks: (input.subtasks ?? []).map((step) => ({ ...step, id: randomUUID() })),
  };
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
