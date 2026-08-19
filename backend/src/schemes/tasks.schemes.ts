import Joi from 'joi';

import { TaskFilter } from '../enum/task-filter.enum.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import type { CreateBasicTask, CreateEventTask } from '../types/tasks.types.js';
import { JoiObject } from '../middlewares/validation/util/validation.util.js';
import {
  byType, DEFAULT_EVENT_ACTIVE_LOGIC, fields, typeOf,
} from './common.schemes.js';

export const CreateBasicTaskSchema = JoiObject<CreateBasicTask>({
  type: typeOf(TaskType.BASIC),
  name: fields.name.required(),
  category: fields.category.default(TaskCategory.OTHER),
  links: fields.links.default([]),
  status: fields.status.default(TaskStatus.TODO),
  subtasks: fields.subtasks.default([]),
});

export const CreateEventTaskSchema = JoiObject<CreateEventTask>({
  type: typeOf(TaskType.EVENT),
  name: fields.name.required(),
  category: fields.category.default(TaskCategory.OTHER),
  links: fields.links.default([]),
  status: fields.status.default(TaskStatus.TODO),
  subtasks: fields.subtasks.default([]),
  date: fields.date.required(),
  // `passedDate` and `configTaskId` are absent on purpose: the server owns both.
  activeLogic: fields.activeLogic.default(DEFAULT_EVENT_ACTIVE_LOGIC),
});

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
/** Body for `PATCH /tasks/:id/status` — the one field, and nothing else. */
export const UpdateTaskStatusSchema = Joi.object({
  status: fields.status.required(),
});

export const ListTasksQuerySchema = Joi.object({
  filter: Joi.string().valid(...Object.values(TaskFilter)),
  category: fields.category,
});

export { TaskIdInParams } from './common.schemes.js';
