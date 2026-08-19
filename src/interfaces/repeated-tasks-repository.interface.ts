import type {
  CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask,
} from '../types/tasks.types.js';
import type { IBaseRepository } from './base-repository.interface.js';

/**
 * Configs live in their own store, apart from the tasks a user works with.
 * They are few, they never carry a date, and keeping them separate means
 * reading them does not mean parsing a file full of generated events.
 */
export type IRepeatedTasksRepository =
  IBaseRepository<RepeatedTask, CreateRepeatedTask, UpdateRepeatedTask>;
