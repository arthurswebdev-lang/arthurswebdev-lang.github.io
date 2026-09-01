import type { TaskCategory } from '../enum/task-category.enum.js';
import type { TaskStatus } from '../enum/task-status.enum.js';
import type { TaskType } from '../enum/task-type.enum.js';
import type { CreateTask, EventTask, Task, UpdateTask } from '../types/tasks.types.js';
import type { RepeatedTask } from '../types/repeated-tasks.types.js';
import type { IBaseRepository } from './base-repository.interface.js';

/**
 * Optional narrowing for `listBy`; omitted fields do not filter. Named a query
 * rather than a filter to keep it distinct from the `TaskFilter` enum, which is
 * the actual/passed/upcoming selector on `GET /tasks`.
 */
export interface TaskQuery {
  /** Required: a query that forgot the owner would read everyone's tasks. */
  userId: string;
  category?: TaskCategory;
  type?: TaskType;
  status?: TaskStatus;
  /** Case-insensitive substring match against the task name. */
  search?: string;
}

export interface ITasksRepository extends IBaseRepository<Task, CreateTask, UpdateTask> {
  /** Tasks matching every provided filter field. */
  listBy(query: TaskQuery): Promise<Task[]>;

  /**
   * Every task, every owner. For the poller only — it marks events passed and
   * tops up configs on behalf of all users, so it cannot scope to one.
   */
  listAcrossUsers(): Promise<Task[]>;

  /**
   * Stores an event produced by a config. Separate from `create` because
   * `configTaskId` is server-owned and therefore absent from `CreateTask`.
   */
  createGeneratedEvent(config: RepeatedTask, date: Date): Promise<EventTask>;

  /**
   * Removes exactly these tasks and nothing else — no cascade to any config.
   * Scoped by owner, so an id belonging to someone else is simply not matched.
   */
  deleteManyByIds(ids: string[], userId: string): Promise<number>;

  /** Removes every event a config produced. Returns how many went. */
  deleteEventsOfConfig(configTaskId: string): Promise<number>;

  /**
   * Records that this event's reminder has been sent. Written before the send,
   * so a pass that overruns the interval cannot announce it twice.
   */
  markNotified(eventId: string, notifiedAt: Date): Promise<EventTask | null>;

  /** Sets just the status; returns null if the id is unknown. */
  updateStatus(id: string, status: TaskStatus): Promise<Task | null>;

  /**
   * Sets the status of one subtask. Returns null when the task or the subtask
   * is unknown — the two are indistinguishable to a caller, and should be.
   */
  updateSubtaskStatus(
    taskId: string,
    subtaskId: string,
    status: TaskStatus.DONE | TaskStatus.TODO,
  ): Promise<Task | null>;

  /** Stamps `passedDate`; returns null if the id is unknown. */
  markEventPassed(eventId: string, passedAt: Date): Promise<EventTask | null>;
}
