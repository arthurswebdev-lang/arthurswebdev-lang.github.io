import type { TaskCategory } from '../enum/task-category.enum.js';
import type { TaskType } from '../enum/task-type.enum.js';
import type { Subtask } from './tasks.types.js';

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
export interface BaseRepeatedTask {
  id: string;
  /** Owner. Set from the credentials, never from the payload. */
  userId: string;
  type: TaskType;
  name: string;
  createdAt: Date;
  category: TaskCategory;
  links: string[];
  /**
   * How long each generated occurrence stays worth acting on, in minutes.
   * Inherited by the event for the same reason as category and links: a
   * generated event cannot be edited, so this can only come from here.
   */
  activeForMins: number;
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
  Omit<T, 'id' | 'userId' | 'createdAt' | 'category' | 'links' | 'activeForMins' | 'subtasks'> & {
    category?: TaskCategory;
    links?: string[];
    activeForMins?: number;
    subtasks?: RepeatedSubtaskDraft[];
  };

export type CreateDailyTask = RepeatedDraft<DailyTask>;
export type CreateWeeklyTask = RepeatedDraft<WeeklyTask>;
export type CreateMonthlyTask = RepeatedDraft<MonthlyTask>;

/** Payload for `POST /repeated-tasks`. */
export type CreateRepeatedTask = CreateDailyTask | CreateWeeklyTask | CreateMonthlyTask;

/** PUT replaces, so an update is the same full representation as a create. */
export type UpdateRepeatedTask = CreateRepeatedTask;
