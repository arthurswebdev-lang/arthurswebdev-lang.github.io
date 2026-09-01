import Joi from 'joi';

import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import type { TaskType } from '../enum/task-type.enum.js';
import type { SubtaskDraft, TaskWindow } from '../types/tasks.types.js';
import type { RepeatedSubtaskDraft, TimeOfDay } from '../types/repeated-tasks.types.js';
import { ID, JoiObject, varchar } from '../middlewares/validation/util/validation.util.js';

/**
 * The window a dated task gets when it does not ask for one.
 *
 * `remindBefore` is zero, so the alert lands on the moment itself — what the
 * app did before the field existed. `activeBefore` is a day, which is the
 * useful reading of "soon" for something you put a date on; the window this
 * replaced defaulted to ten days, so an interview sat in Actual for a week and
 * a half. `activeFor` is ten minutes: enough that reaching for the phone does
 * not already put the thing you were alerted about under "missed".
 */
export const DEFAULT_REMIND_BEFORE_MINS = 0;
export const DEFAULT_ACTIVE_BEFORE_MINS = 24 * 60;
export const DEFAULT_ACTIVE_FOR_MINS = 10;

/** Fills in whichever of the three the client left out. */
export function windowWithDefaults(input: Partial<TaskWindow>): TaskWindow {
  return {
    remindBeforeMins: input.remindBeforeMins ?? DEFAULT_REMIND_BEFORE_MINS,
    activeBeforeMins: input.activeBeforeMins ?? DEFAULT_ACTIVE_BEFORE_MINS,
    activeForMins: input.activeForMins ?? DEFAULT_ACTIVE_FOR_MINS,
  };
}

/** A year. Past this, "still active" stops meaning anything. */
const MAX_WINDOW_MINS = 525_600;

/** http(s) only: these get opened, so a javascript: or file: URL has no place. */
const link = Joi.string().uri({ scheme: ['http', 'https'] }).max(2048);

export const TimeOfDaySchema = JoiObject<TimeOfDay>({
  hour: Joi.number().integer().min(0).max(23).required(),
  minute: Joi.number().integer().min(0).max(59).required(),
});

export const SubtaskSchema = JoiObject<SubtaskDraft>({
  name: varchar(1, 255).required(),
  status: Joi.string().valid(TaskStatus.DONE, TaskStatus.TODO).default(TaskStatus.TODO),
  link,
});

/**
 * The same step without a status: a config's checklist is a template, and a
 * template has nothing ticked. Sending one is a 400 rather than a field quietly
 * dropped, so nobody believes they have pre-completed next week's session.
 */
export const RepeatedSubtaskSchema = JoiObject<RepeatedSubtaskDraft>({
  name: varchar(1, 255).required(),
  link,
});

/**
 * Field definitions shared by every variant schema, for both tasks and configs.
 * They carry no `required()` or `default()` of their own, so each schema states
 * its own expectations.
 */
export const fields = {
  name: varchar(1, 255),
  category: Joi.string().valid(...Object.values(TaskCategory)),
  link,
  links: Joi.array().items(link).max(20).unique(),
  status: Joi.string().valid(...Object.values(TaskStatus)),
  subtasks: Joi.array().items(SubtaskSchema),
  /** A config's steps: the same list, minus the ticks. */
  repeatedSubtasks: Joi.array().items(RepeatedSubtaskSchema),
  date: Joi.date().iso(),
  time: TimeOfDaySchema,
  /** 0 = Sunday ... 6 = Saturday, each day at most once. */
  weekdays: Joi.array().items(Joi.number().integer().min(0).max(6)).unique().min(1),
  /**
   * The three windows, all in minutes from the task's own date. Zero is
   * meaningful for the two "before" fields — remind me exactly on time, show me
   * only once it starts — but not for `activeFor`, where it would mean the task
   * is passed the instant it arrives.
   */
  remindBeforeMins: Joi.number().integer().min(0).max(MAX_WINDOW_MINS),
  activeBeforeMins: Joi.number().integer().min(0).max(MAX_WINDOW_MINS),
  activeForMins: Joi.number().integer().min(1).max(MAX_WINDOW_MINS),
  dayOfMonth: Joi.number().integer().min(1).max(31),
  /** 1 = January ... 12 = December, each month at most once. */
  months: Joi.array().items(Joi.number().integer().min(1).max(12)).unique().min(1),
};

// Each variant pins its own literal, so the schema that runs and the branch the
// TypeScript union narrows to are always the same one.
export const typeOf = (type: TaskType) => Joi.string().valid(type).required();

/** Picks the variant schema by `type`, the same way the union discriminates. */
export function byType(
  schemas: Partial<Record<TaskType, Joi.ObjectSchema>>,
): Joi.AlternativesSchema {
  const allowed = Object.keys(schemas);

  return Joi.alternatives().conditional('.type', {
    switch: Object.entries(schemas).map(([type, then]) => ({ is: type, then })),
    otherwise: Joi.any().forbidden().messages({
      'any.unknown': `"type" must be one of [${allowed.join(', ')}]`,
    }),
  });
}

/** The three window keys with their defaults, shared by every dated schema. */
export const windowFields = {
  remindBeforeMins: fields.remindBeforeMins.default(DEFAULT_REMIND_BEFORE_MINS),
  activeBeforeMins: fields.activeBeforeMins.default(DEFAULT_ACTIVE_BEFORE_MINS),
  activeForMins: fields.activeForMins.default(DEFAULT_ACTIVE_FOR_MINS),
};

/**
 * Rejects a reminder that would arrive before the task is visible.
 *
 * Being pinged at 13:00 about something the list hides until 14:00 is never
 * what anyone meant: tapping the notification opens Actual, and the task is not
 * in it. Checked on the object rather than the field so it runs after defaults
 * are filled in — a ref would resolve against a key the client never sent.
 */
export function assertWindowOrder<T>(schema: Joi.ObjectSchema<T>): Joi.ObjectSchema<T> {
  return schema.custom((value: T, helpers) => {
    const window = value as unknown as { remindBeforeMins: number; activeBeforeMins: number };

    return window.remindBeforeMins > window.activeBeforeMins
      ? helpers.error('window.order')
      : value;
  }).messages({
    'window.order': '"remindBeforeMins" cannot be longer than "activeBeforeMins" —'
      + ' that would announce a task while it is still hidden under upcoming.',
  });
}

export const TaskIdInParams = Joi.object({ id: ID.required() });
