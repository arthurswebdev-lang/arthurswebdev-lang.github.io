import type { TaskFilter } from '../enum/task-filter.enum.js';
import type { CreateTask, Task, UpdateTask } from '../types/tasks.types.js';

export interface ITasksService {
  /**
   * Stored tasks, in insertion order. With a filter, only the events in that
   * state; without one, everything including basic tasks.
   */
  listAll(filter?: TaskFilter): Promise<Task[]>;

  /** The task with this id, or `null` when nothing matches. */
  getById(id: string): Promise<Task | null>;

  create(input: CreateTask): Promise<Task>;

  /** Applies `changes` to the stored task; throws when the id is unknown. */
  updateById(id: string, changes: UpdateTask): Promise<Task>;

  /** Removes the task; throws when the id is unknown. */
  deleteById(id: string): Promise<void>;
}
