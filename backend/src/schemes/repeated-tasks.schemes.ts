import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import type { CreateDailyTask, CreateMonthlyTask, CreateWeeklyTask } from '../types/repeated-tasks.types.js';
import { JoiObject } from '../middlewares/validation/util/validation.util.js';
import {
  assertWindowOrder, byType, fields, typeOf, windowFields,
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
