import Joi from 'joi';

import { TaskFilter } from '../enum/task-filter.enum.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import type { CreateBasicTask, CreateEventTask } from '../types/tasks.types.js';
import { ID, JoiObject } from '../middlewares/validation/util/validation.util.js';
import {
  assertWindowOrder, byType, fields, typeOf, windowFields,
} from './common.schemes.js';

export const CreateBasicTaskSchema = JoiObject<CreateBasicTask>({
  type: typeOf(TaskType.BASIC),
  name: fields.name.required(),
  category: fields.category.default(TaskCategory.OTHER),
  links: fields.links.default([]),
  status: fields.status.default(TaskStatus.TODO),
  subtasks: fields.subtasks.default([]),
});

export const CreateEventTaskSchema = assertWindowOrder(JoiObject<CreateEventTask>({
  type: typeOf(TaskType.EVENT),
  name: fields.name.required(),
  category: fields.category.default(TaskCategory.OTHER),
  links: fields.links.default([]),
  status: fields.status.default(TaskStatus.TODO),
  subtasks: fields.subtasks.default([]),
  date: fields.date.required(),
  // `passedDate`, `notifiedAt` and `configTaskId` are absent on purpose: the
  // server owns all three.
  ...windowFields,
}));

/** Body schema for `POST /tasks`. Configs are a different resource entirely. */
export const CreateTaskSchema = byType({
  [TaskType.BASIC]: CreateBasicTaskSchema,
  [TaskType.EVENT]: CreateEventTaskSchema,
});

/**
 * Body schema for `PUT /tasks/:id`. PUT replaces the task, so the body is the
 * same full representation as a create.
 */
export const UpdateTaskSchema = CreateTaskSchema;

/**
 * Query for `GET /tasks`. Deliberately narrow: it lists only what is actually
 * implemented, so `?limit=5` is a 400 rather than a parameter that quietly
 * does nothing. Pagination and the type/status/search narrowing exist on the
 * repository (`listBy`) and can be added here when they are wired up.
 */
/** Body for `POST /tasks/clear`: the exact tasks to remove. */
export const ClearTasksSchema = Joi.object({
  ids: Joi.array().items(ID).min(1).max(200).unique()
    .required(),
});

/** Params for the subtask route: both ids, both uuids. */
export const SubtaskIdInParams = Joi.object({
  id: ID.required(),
  subtaskId: ID.required(),
});

/** A step is atomic, so it is only ever done or not. */
export const UpdateSubtaskStatusSchema = Joi.object({
  status: Joi.string().valid(TaskStatus.DONE, TaskStatus.TODO).required(),
});

/** Body for `PATCH /tasks/:id/status` — the one field, and nothing else. */
export const UpdateTaskStatusSchema = Joi.object({
  status: fields.status.required(),
});

export const ListTasksQuerySchema = Joi.object({
  filter: Joi.string().valid(...Object.values(TaskFilter)),
  category: fields.category,
});

export { TaskIdInParams } from './common.schemes.js';
