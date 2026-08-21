import { randomUUID } from 'node:crypto';

import { TaskCategory } from '../enum/task-category.enum.js';
import { DEFAULT_ACTIVE_FOR_MINS } from '../schemes/common.schemes.js';

import type { Db } from 'mongodb';

import type { IRepeatedTasksRepository } from '../interfaces/repeated-tasks-repository.interface.js';
import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../types/repeated-tasks.types.js';
import { InputValidationError } from '../utils/http-errors/input-validation.error.js';
import { MongoRepository } from './mongo.repository.js';

export const REPEATED_TASKS_COLLECTION = 'repeatedTasks';

/** The repeated-task configs, in their own collection. */
export class RepeatedTasksRepository
  extends MongoRepository<RepeatedTask, CreateRepeatedTask, UpdateRepeatedTask>
  implements IRepeatedTasksRepository {
  constructor(db: Db) {
    super(db, REPEATED_TASKS_COLLECTION);
  }

  /** Configs are always read per owner. */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ userId: 1 });
  }

  /** Unscoped on purpose; see the interface. */
  async listAcrossUsers(): Promise<RepeatedTask[]> {
    const documents = await this.collection.find().toArray();

    return documents.map((document) => this.toDomain(document));
  }

  async listByIds(ids: string[]): Promise<RepeatedTask[]> {
    if (ids.length === 0) return [];

    const documents = await this.collection.find({ _id: { $in: ids } }).toArray();

    return documents.map((document) => this.toDomain(document));
  }

  protected toEntity(input: CreateRepeatedTask, userId: string): RepeatedTask {
    return {
      ...input,
      id: randomUUID(),
      userId,
      createdAt: new Date(),
      category: input.category ?? TaskCategory.OTHER,
      links: input.links ?? [],
      activeForMins: input.activeForMins ?? DEFAULT_ACTIVE_FOR_MINS,
    };
  }

  /** PUT replaces the config outright; only id and createdAt survive. */
  protected applyUpdate(entity: RepeatedTask, changes: UpdateRepeatedTask): RepeatedTask {
    if (changes.type !== entity.type) {
      throw new InputValidationError(
        `A repeated task cannot change type (${entity.type} -> ${changes.type})`,
      );
    }

    return {
      ...this.toEntity(changes, entity.userId),
      id: entity.id,
      userId: entity.userId,
      createdAt: entity.createdAt,
    };
  }
}
