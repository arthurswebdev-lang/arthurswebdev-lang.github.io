import Joi from 'joi';

import { ActiveLogic } from '../enum/active-logic.enum.js';
import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import type { TaskType } from '../enum/task-type.enum.js';
import type { SubtaskDraft } from '../types/tasks.types.js';
import type { TimeOfDay } from '../types/repeated-tasks.types.js';
import { ID, JoiObject, varchar } from '../middlewares/validation/util/validation.util.js';

/** Active logic given to an event the client created directly. */
export const DEFAULT_EVENT_ACTIVE_LOGIC = ActiveLogic.NEXT_30_DAYS;

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
  date: Joi.date().iso(),
  time: TimeOfDaySchema,
  /** 0 = Sunday ... 6 = Saturday, each day at most once. */
  weekdays: Joi.array().items(Joi.number().integer().min(0).max(6)).unique().min(1),
  dayOfMonth: Joi.number().integer().min(1).max(31),
  /** 1 = January ... 12 = December, each month at most once. */
  months: Joi.array().items(Joi.number().integer().min(1).max(12)).unique().min(1),
  activeLogic: Joi.string().valid(...Object.values(ActiveLogic)),
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

export const TaskIdInParams = Joi.object({ id: ID.required() });
