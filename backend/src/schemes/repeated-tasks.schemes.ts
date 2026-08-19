import Joi from 'joi';

import { TaskType } from '../enum/task-type.enum.js';
import type { CreateDailyTask, CreateMonthlyTask, CreateWeeklyTask } from '../types/repeated-tasks.types.js';
import { JoiObject } from '../middlewares/validation/util/validation.util.js';
import { byType, fields, typeOf } from './common.schemes.js';

export const CreateDailyTaskSchema = JoiObject<CreateDailyTask>({
  type: typeOf(TaskType.REPEATED_DAILY),
  name: fields.name.required(),
  startsAt: fields.time.required(),
  endsAt: fields.time.required(),
  repeatEach: fields.time.required(),
});

export const CreateWeeklyTaskSchema = JoiObject<CreateWeeklyTask>({
  type: typeOf(TaskType.REPEATED_WEEKLY),
  name: fields.name.required(),
  weekdays: fields.weekdays.required(),
});

export const CreateMonthlyTaskSchema = JoiObject<CreateMonthlyTask>({
  type: typeOf(TaskType.REPEATED_MONTHLY),
  name: fields.name.required(),
  fromDay: fields.dayOfMonth.required(),
  toDay: fields.dayOfMonth.min(Joi.ref('fromDay')).required(),
  months: fields.months.required(),
});

/** Body schema for `POST /repeated-tasks`. */
export const CreateRepeatedTaskSchema = byType({
  [TaskType.REPEATED_DAILY]: CreateDailyTaskSchema,
  [TaskType.REPEATED_WEEKLY]: CreateWeeklyTaskSchema,
  [TaskType.REPEATED_MONTHLY]: CreateMonthlyTaskSchema,
});

/** Body schema for `PUT /repeated-tasks/:id` — replacement, same as create. */
export const UpdateRepeatedTaskSchema = CreateRepeatedTaskSchema;
