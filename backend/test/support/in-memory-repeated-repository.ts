import { randomUUID } from 'node:crypto';

import { TaskCategory } from '../../src/enum/task-category.enum.js';

import type {
  IRepeatedTasksRepository,
} from '../../src/interfaces/repeated-tasks-repository.interface.js';
import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../../src/types/repeated-tasks.types.js';

/** The configs store, backed by an array. */
export class InMemoryRepeatedTasksRepository implements IRepeatedTasksRepository {
  constructor(private configs: RepeatedTask[] = []) {}

  list(userId: string): Promise<RepeatedTask[]> {
    return Promise.resolve(this.configs.filter((config) => config.userId === userId));
  }

  listAcrossUsers(): Promise<RepeatedTask[]> {
    return Promise.resolve([...this.configs]);
  }

  getById(id: string): Promise<RepeatedTask | null> {
    return Promise.resolve(this.configs.find((config) => config.id === id) ?? null);
  }

  create(input: CreateRepeatedTask, userId: string): Promise<RepeatedTask> {
    const config: RepeatedTask = {
      ...input,
      id: randomUUID(),
      userId,
      createdAt: new Date(),
      category: input.category ?? TaskCategory.OTHER,
      links: input.links ?? [],
    };

    this.configs.push(config);

    return Promise.resolve(config);
  }

  updateById(id: string, changes: UpdateRepeatedTask): Promise<RepeatedTask | null> {
    const index = this.configs.findIndex((config) => config.id === id);
    const found = this.configs[index];
    if (found === undefined) return Promise.resolve(null);

    const updated = { ...found, ...changes, id: found.id, createdAt: found.createdAt };
    this.configs[index] = updated;

    return Promise.resolve(updated);
  }

  deleteById(id: string): Promise<boolean> {
    const before = this.configs.length;
    this.configs = this.configs.filter((config) => config.id !== id);

    return Promise.resolve(this.configs.length < before);
  }
}
