import { randomUUID } from 'node:crypto';

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

  /** Nothing to index yet: configs are few and always read as a whole list. */
  ensureIndexes(): Promise<void> {
    return Promise.resolve();
  }

  protected toEntity(input: CreateRepeatedTask): RepeatedTask {
    return { ...input, id: randomUUID(), createdAt: new Date() };
  }

  /** PUT replaces the config outright; only id and createdAt survive. */
  protected applyUpdate(entity: RepeatedTask, changes: UpdateRepeatedTask): RepeatedTask {
    if (changes.type !== entity.type) {
      throw new InputValidationError(
        `A repeated task cannot change type (${entity.type} -> ${changes.type})`,
      );
    }

    return { ...this.toEntity(changes), id: entity.id, createdAt: entity.createdAt };
  }
}
