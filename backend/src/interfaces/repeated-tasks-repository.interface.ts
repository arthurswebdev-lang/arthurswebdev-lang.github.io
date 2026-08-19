import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../types/repeated-tasks.types.js';
import type { IBaseRepository } from './base-repository.interface.js';

/**
 * Configs live in their own store, apart from the tasks a user works with.
 * They are few, they never carry a date, and keeping them separate means
 * reading them does not mean parsing a file full of generated events.
 */
export interface IRepeatedTasksRepository
  extends IBaseRepository<RepeatedTask, CreateRepeatedTask, UpdateRepeatedTask> {
  /** Every config, every owner — for the poller, which serves all users. */
  listAcrossUsers(): Promise<RepeatedTask[]>;

  /** The configs with these ids, in one query — for joining onto events. */
  listByIds(ids: string[]): Promise<RepeatedTask[]>;
}
