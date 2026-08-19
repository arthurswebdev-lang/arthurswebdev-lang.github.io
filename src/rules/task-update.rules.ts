import { isEventTask, isGeneratedEvent } from '../filters/tasks.filters.js';
import type {
  CreateEventTask, RepeatedTask, Task, UpdateRepeatedTask, UpdateTask,
} from '../types/tasks.types.js';
import { InputValidationError } from '../utils/http-errors/input-validation.error.js';

/**
 * What a client is allowed to change, and where.
 *
 * A generated event is a projection of its config: its name, date and active
 * logic all come from the config, and the next regeneration would overwrite
 * anything typed over them. So the only field it accepts is `status` — done or
 * not done. Everything else is edited on the config, which regenerates.
 *
 * One rule per function, so each can be read on its own.
 */

/** Fields of a generated event a client may not touch. */
export const READ_ONLY_ON_GENERATED_EVENT = ['name', 'date', 'activeLogic', 'subtasks'] as const;

function sameInstant(left: Date, right: Date | string): boolean {
  return left.getTime() === new Date(right).getTime();
}

/** Subtasks compared by what a client can actually set: their names and states. */
function sameSubtasks(current: { name: string }[], incoming: { name: string }[] = []): boolean {
  return current.length === incoming.length
    && current.every((subtask, index) => subtask.name === incoming[index]?.name);
}

/**
 * Which protected fields the payload would change. Empty means the update only
 * touches `status`.
 */
export function protectedFieldsChanged(current: Task, changes: CreateEventTask): string[] {
  if (!isEventTask(current)) return [];

  const changed: string[] = [];

  if (changes.name !== current.name) changed.push('name');
  if (!sameInstant(current.date, changes.date)) changed.push('date');
  if (changes.activeLogic !== current.activeLogic) changed.push('activeLogic');
  if (!sameSubtasks(current.subtasks, changes.subtasks)) changed.push('subtasks');

  return changed;
}

/** True when this update is one a generated event is allowed to accept. */
export function isStatusOnlyUpdate(current: Task, changes: UpdateTask): boolean {
  if (changes.type !== current.type || !isEventTask(current)) return false;

  return protectedFieldsChanged(current, changes as CreateEventTask).length === 0;
}

/**
 * Guards `PUT /tasks/:id`. Hand-made events are unaffected — they have no
 * config to edit instead, so they take a full replacement like anything else.
 */
export function assertTaskUpdateAllowed(current: Task, changes: UpdateTask): void {
  if (!isEventTask(current) || !isGeneratedEvent(current)) return;
  if (isStatusOnlyUpdate(current, changes)) return;

  const changed = protectedFieldsChanged(current, changes as CreateEventTask);

  throw new InputValidationError(
    `A generated event only accepts status changes; ${changed.join(', ')} `
    + `must be changed on its repeated task (${String(current.configTaskId)}) instead.`,
    changed,
  );
}

/**
 * Guards `PUT /repeated-tasks/:id`. A config is never done — it is a rule, not
 * a to-do — so its status is fixed. Stopping one means deleting it.
 */
export function assertRepeatedTaskUpdateAllowed(
  current: RepeatedTask,
  changes: UpdateRepeatedTask,
): void {
  const incoming = changes.status ?? current.status;
  if (incoming === current.status) return;

  throw new InputValidationError(
    "A repeated task's status cannot be changed; it is a rule, not a to-do. "
    + 'Change the status of the event it generated, or delete the repeated task.',
    ['status'],
  );
}
