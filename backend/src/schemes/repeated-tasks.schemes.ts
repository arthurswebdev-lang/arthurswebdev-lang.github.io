import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import Joi from 'joi';

import type {
  CreateDailyTask, CreateMonthlyTask, CreateWeeklyTask, PatchRepeatedTask,
} from '../types/repeated-tasks.types.js';
import { JoiObject } from '../middlewares/validation/util/validation.util.js';
import {
  ALL_WEEKDAYS, assertWindowOrder, byType, fields, typeOf, windowFields,
} from './common.schemes.js';

export const CreateDailyTaskSchema = assertWindowOrder(JoiObject<CreateDailyTask>({
  type: typeOf(TaskType.REPEATED_DAILY),
  name: fields.name.required(),
  category: fields.category.default(TaskCategory.OTHER),
  links: fields.links.default([]),
  ...windowFields,
  subtasks: fields.repeatedSubtasks.default([]),
  startsAt: fields.time.required(),
  endsAt: fields.time.required(),
  repeatEach: fields.time.required(),
  // Defaulted, not required: every existing daily config was written before
  // this field existed and means every day.
  weekdays: fields.weekdays.default(ALL_WEEKDAYS),
}));

export const CreateWeeklyTaskSchema = assertWindowOrder(JoiObject<CreateWeeklyTask>({
  type: typeOf(TaskType.REPEATED_WEEKLY),
  name: fields.name.required(),
  category: fields.category.default(TaskCategory.OTHER),
  links: fields.links.default([]),
  ...windowFields,
  subtasks: fields.repeatedSubtasks.default([]),
  weekdays: fields.weekdays.required(),
}));

export const CreateMonthlyTaskSchema = assertWindowOrder(JoiObject<CreateMonthlyTask>({
  type: typeOf(TaskType.REPEATED_MONTHLY),
  name: fields.name.required(),
  category: fields.category.default(TaskCategory.OTHER),
  links: fields.links.default([]),
  ...windowFields,
  subtasks: fields.repeatedSubtasks.default([]),
  fromDay: fields.dayOfMonth.required(),
  months: fields.months.required(),
}));

/** Body schema for `POST /repeated-tasks`. */
export const CreateRepeatedTaskSchema = byType({
  [TaskType.REPEATED_DAILY]: CreateDailyTaskSchema,
  [TaskType.REPEATED_WEEKLY]: CreateWeeklyTaskSchema,
  [TaskType.REPEATED_MONTHLY]: CreateMonthlyTaskSchema,
});

/** Body schema for `PUT /repeated-tasks/:id` — replacement, same as create. */
export const UpdateRepeatedTaskSchema = CreateRepeatedTaskSchema;

/**
 * Body schema for `PATCH /repeated-tasks/:id`: any subset of the fields, and at
 * least one of them.
 *
 * Every variant's schedule fields are allowed here because the middleware
 * cannot know which kind of config it is patching — that needs the stored row.
 * The service merges the patch onto it and runs the full schema over the
 * result, which is where `fromDay` on a weekly config is refused.
 *
 * `type` is accepted but cannot change anything: a client holding the whole
 * config should be able to PATCH it back without stripping a field first, and
 * a type that disagrees with the stored one is rejected by the repository.
 */
export const PatchRepeatedTaskSchema = JoiObject<PatchRepeatedTask>({
  type: Joi.string().valid(...Object.values(TaskType)),
  name: fields.name,
  category: fields.category,
  links: fields.links,
  subtasks: fields.repeatedSubtasks,
  remindBeforeMins: fields.remindBeforeMins,
  activeBeforeMins: fields.activeBeforeMins,
  activeForMins: fields.activeForMins,
  startsAt: fields.time,
  endsAt: fields.time,
  repeatEach: fields.time,
  weekdays: fields.weekdays,
  fromDay: fields.dayOfMonth,
  months: fields.months,
}).min(1).messages({
  'object.min': 'A patch must name at least one field to change.',
});
