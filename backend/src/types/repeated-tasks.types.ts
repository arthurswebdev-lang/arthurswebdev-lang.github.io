import type { TaskCategory } from '../enum/task-category.enum.js';
import type { TaskType } from '../enum/task-type.enum.js';
import type { Subtask, TaskWindow } from './tasks.types.js';

/**
 * Repeated tasks are **configs**, not tasks. They are the rule that generates
 * event tasks; nobody completes them, so they deliberately do not share
 * `BaseTask`. Fields a task needs and a config does not — `status` above all —
 * are simply absent rather than carried and ignored.
 */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

/**
 * One step in the checklist a config stamps onto every occurrence it generates.
 *
 * A `Subtask` without its `status`, for exactly the reason a config has no
 * `status` of its own: nobody completes a rule. The status is born on the
 * generated event as TODO, and lives and dies with that one occurrence — last
 * week's gym session being finished says nothing about this week's.
 */
export type RepeatedSubtask = Omit<Subtask, 'status'>;

/** A config step as the client sends it: the server assigns the id. */
export type RepeatedSubtaskDraft = Omit<RepeatedSubtask, 'id'>;

/**
 * What every config carries, whichever schedule it describes.
 *
 * Category and links sit here as well as on tasks because a generated event
 * inherits both: a weekly standup needs its call link on every occurrence, and
 * a generated event cannot be edited to add one.
 */
export interface BaseRepeatedTask extends TaskWindow {
  id: string;
  /** Owner. Set from the credentials, never from the payload. */
  userId: string;
  type: TaskType;
  name: string;
  createdAt: Date;
  category: TaskCategory;
  links: string[];
  /**
   * The checklist every occurrence starts with. Inherited for the same reason
   * again — `PUT /tasks/:id` refuses a generated event's subtasks, so a
   * recurring routine's steps have nowhere else to come from.
   */
  subtasks: RepeatedSubtask[];
}

export interface DailyTask extends BaseRepeatedTask {
  type: TaskType.REPEATED_DAILY;
  startsAt: TimeOfDay;
  endsAt: TimeOfDay;
  /** Gap between two runs within the window, as hours + minutes. */
  repeatEach: TimeOfDay;
  /**
   * Days of the week the window opens on: 0 = Sunday ... 6 = Saturday.
   *
   * The same field a weekly config carries, and it means the same thing — a
   * daily config is a weekly one that fires several times on each of its days.
   * It defaults to all seven, so "daily" keeps meaning every day until days are
   * deselected; Monday to Friday is what it is actually for.
   */
  weekdays: number[];
}

export interface WeeklyTask extends BaseRepeatedTask {
  type: TaskType.REPEATED_WEEKLY;
  /** Days of the week the task repeats on: 0 = Sunday ... 6 = Saturday. */
  weekdays: number[];
}

export interface MonthlyTask extends BaseRepeatedTask {
  type: TaskType.REPEATED_MONTHLY;
  /** Day of month the occurrence falls on, 1-31. */
  fromDay: number;
  /** Months the task repeats in: 1 = January ... 12 = December. */
  months: number[];
}

export type RepeatedTask = DailyTask | WeeklyTask | MonthlyTask;

/** A config as the client sends it: the server owns `id` and `createdAt`. */
export type RepeatedDraft<T extends BaseRepeatedTask> =
  Omit<
    T,
    'id' | 'userId' | 'createdAt' | 'category' | 'links' | 'subtasks'
    | 'remindBeforeMins' | 'activeBeforeMins' | 'activeForMins'
  > & {
    category?: TaskCategory;
    links?: string[];
    remindBeforeMins?: number;
    activeBeforeMins?: number;
    activeForMins?: number;
    subtasks?: RepeatedSubtaskDraft[];
  };

/**
 * `weekdays` is optional here alone: a weekly config with no days would fire
 * never, so it is required there, while a daily one falls back to all seven.
 */
export type CreateDailyTask = Omit<RepeatedDraft<DailyTask>, 'weekdays'> & {
  weekdays?: number[];
};
export type CreateWeeklyTask = RepeatedDraft<WeeklyTask>;
export type CreateMonthlyTask = RepeatedDraft<MonthlyTask>;

/** Payload for `POST /repeated-tasks`. */
export type CreateRepeatedTask = CreateDailyTask | CreateWeeklyTask | CreateMonthlyTask;

/** PUT replaces, so an update is the same full representation as a create. */
export type UpdateRepeatedTask = CreateRepeatedTask;

/**
 * PATCH changes only what it names, so a patch never has to restate what it is
 * not touching. `type` is allowed but cannot change anything — a client holding
 * the whole config can send it straight back, and a type that disagrees with
 * the stored one is refused.
 *
 * Deliberately the union of every variant's fields rather than a variant of its
 * own: the middleware cannot know which kind it is looking at until the stored
 * config is read. The service merges the patch onto that config and validates
 * the result against the full schema, so a field belonging to another variant
 * is refused there rather than being quietly stored.
 */
export type PatchRepeatedTask = Partial<
  Omit<CreateDailyTask, 'type'> & Omit<CreateWeeklyTask, 'type'> & Omit<CreateMonthlyTask, 'type'>
> & { type?: TaskType };
