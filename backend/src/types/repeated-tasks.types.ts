import type { TaskType } from '../enum/task-type.enum.js';

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

/** What every config carries, whichever schedule it describes. */
export interface BaseRepeatedTask {
  id: string;
  type: TaskType;
  name: string;
  createdAt: Date;
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
  /** Day of month the window opens on, 1-31. */
  fromDay: number;
  /** Day of month the window closes on, 1-31. */
  toDay: number;
  /** Months the task repeats in: 1 = January ... 12 = December. */
  months: number[];
}

export type RepeatedTask = DailyTask | WeeklyTask | MonthlyTask;

/** A config as the client sends it: the server owns `id` and `createdAt`. */
export type RepeatedDraft<T extends BaseRepeatedTask> = Omit<T, 'id' | 'createdAt'>;

export type CreateDailyTask = RepeatedDraft<DailyTask>;
export type CreateWeeklyTask = RepeatedDraft<WeeklyTask>;
export type CreateMonthlyTask = RepeatedDraft<MonthlyTask>;

/** Payload for `POST /repeated-tasks`. */
export type CreateRepeatedTask = CreateDailyTask | CreateWeeklyTask | CreateMonthlyTask;

/** PUT replaces, so an update is the same full representation as a create. */
export type UpdateRepeatedTask = CreateRepeatedTask;
