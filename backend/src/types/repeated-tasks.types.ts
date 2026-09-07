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
  /** Inherited by every occurrence, exactly like `links`. */
  photoUrl?: string;
  /**
   * The checklist every occurrence starts with. Inherited for the same reason
   * again — `PUT /tasks/:id` refuses a generated event's subtasks, so a
   * recurring routine's steps have nowhere else to come from.
   */
  subtasks: RepeatedSubtask[];
  /**
   * The times of day this config fires at, on each day it runs.
   *
   * The one field that says *when within a day*, and every schedule has it: a
   * config is "which days, and at what times on them". Several times a day used
   * to be a daily config's private trick, expressed as a window plus a step —
   * now it is just a longer list, and a weekly config can do it too.
   *
   * Stored sorted and without duplicates, so generation walks them in order and
   * two spellings of the same schedule compare equal.
   */
  timesOfDay: TimeOfDay[];
  /**
   * Whether this rule is still running. `false` is a pause, not a delete.
   *
   * A paused config keeps everything — its name, steps, photo, schedule — and
   * simply stops being asked for occurrences. It is for a repeat you are not
   * doing at the moment but do not want to lose or retype: a routine you are
   * off for a month, a set of exercises set up on an account you are not using
   * yet. Pausing also clears the one occurrence it had waiting, so the list
   * goes quiet rather than keeping a task nothing will ever regenerate.
   *
   * Defaults to true, so a config is running unless it is deliberately stopped.
   */
  enabled: boolean;
}

/**
 * Daily and weekly are now the same shape, and differ only in what happens when
 * you name no days: a daily config falls back to all seven, a weekly one is
 * refused. That is the whole distinction, and it is kept because "daily" and
 * "weekly" are what the person choosing them means, not because the generator
 * needs to tell them apart.
 */
export interface DailyTask extends BaseRepeatedTask {
  type: TaskType.REPEATED_DAILY;
  /**
   * Days of the week it runs on: 0 = Sunday ... 6 = Saturday.
   *
   * Defaults to all seven, so "daily" keeps meaning every day until days are
   * deselected; Monday to Friday is what it is actually for.
   */
  weekdays: number[];
}

export interface WeeklyTask extends BaseRepeatedTask {
  type: TaskType.REPEATED_WEEKLY;
  /** Days of the week it repeats on: 0 = Sunday ... 6 = Saturday. At least one. */
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
    'id' | 'userId' | 'createdAt' | 'category' | 'links' | 'subtasks' | 'timesOfDay'
    | 'enabled' | 'remindBeforeMins' | 'activeBeforeMins' | 'activeForMins'
  > & {
    /** Left out means running: a config has to be paused on purpose. */
    enabled?: boolean;
    category?: TaskCategory;
    links?: string[];
    remindBeforeMins?: number;
    activeBeforeMins?: number;
    activeForMins?: number;
    subtasks?: RepeatedSubtaskDraft[];
    /** Left out means one occurrence a day, at `DEFAULT_TIME_OF_DAY`. */
    timesOfDay?: TimeOfDay[];
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
