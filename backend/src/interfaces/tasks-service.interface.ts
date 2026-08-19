import type { TaskCategory } from '../enum/task-category.enum.js';
import type { TaskFilter } from '../enum/task-filter.enum.js';
import type { TaskStatus } from '../enum/task-status.enum.js';
import type {
  CreateTask, Task, TaskWithConfig, UpdateTask,
} from '../types/tasks.types.js';

/**
 * One object rather than positional arguments: `userId` and `filter` are both
 * strings, so passing them the wrong way round type-checks and then silently
 * returns nothing.
 */
export interface ListTasksQuery {
  userId: string;
  filter?: TaskFilter;
  category?: TaskCategory;
}

export interface ITasksService {
  /**
   * Stored tasks, in insertion order. With a filter, only the events in that
   * state; without one, everything including basic tasks.
   */
  listAll(query: ListTasksQuery): Promise<TaskWithConfig[]>;

  /** The task with this id, or `null` when nothing matches. */
  getById(id: string, userId: string): Promise<TaskWithConfig | null>;

  create(input: CreateTask, userId: string): Promise<Task>;

  /** Changes only the status; throws when the id is unknown. */
  updateStatus(id: string, userId: string, status: TaskStatus): Promise<Task>;

  /** Ticks one step of a task off, or back on. */
  updateSubtaskStatus(
    taskId: string,
    userId: string,
    subtaskId: string,
    status: TaskStatus.DONE | TaskStatus.TODO,
  ): Promise<Task>;

  /** Applies `changes` to the stored task; throws when the id is unknown. */
  updateById(id: string, userId: string, changes: UpdateTask): Promise<Task>;

  /** Removes the task; throws when the id is unknown. */
  deleteById(id: string, userId: string): Promise<void>;
}
