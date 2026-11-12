import { TaskStatus } from '../enum/task-status.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import type { IRepeatedTasksService } from '../interfaces/repeated-tasks-service.interface.js';
import type { ITasksService } from '../interfaces/tasks-service.interface.js';
import type {
  AssistantSession, CreatedItem, PlanChange, PlanDraft,
} from '../types/assistant.types.js';
import type { PatchRepeatedTask } from '../types/repeated-tasks.types.js';
import type { Subtask, Task, UpdateTask } from '../types/tasks.types.js';
import { InputValidationError } from '../utils/http-errors/input-validation.error.js';
import { buildPayload } from '../utils/plan-payload.util.js';
import { configToDraft, taskToDraft } from '../utils/plan-draft.util.js';

/**
 * Edits through the assistant: read the stored item, merge only the fields the
 * model named onto it (on the person's clock), and validate the result exactly
 * like a new item. Applying goes through the same service methods the API
 * routes use — PATCH for a repeat, PUT or the status route for a task — so
 * every existing rule still holds:
 *
 * - a task a repeat generated accepts only a status change (`task-update.rules`);
 * - editing a repeat rewrites or regenerates its occurrences as the schedule
 *   rules say, and keeps the ticks on a started one;
 * - nothing here deletes.
 */

type Fields = Record<string, unknown>;

/** The draft fields a change may set. `kind` is never one: a variant is fixed. */
const EDITABLE = [
  'name', 'category', 'links', 'photoUrl', 'steps', 'date', 'times', 'timeGrid', 'weekdays',
  'dayOfMonth', 'months', 'remindBeforeMins', 'activeBeforeMins', 'activeForMins', 'enabled',
] as const;

const editedKeys = (input: Fields) => EDITABLE.filter((key) => key in input);

/** The stored item with the named fields replaced. A new time list replaces a grid. */
export function mergeDraft(before: PlanDraft, input: Fields): PlanDraft {
  const merged: Fields = { ...before };
  for (const key of editedKeys(input)) merged[key] = input[key];
  if ('times' in input) delete merged['timeGrid'];
  if ('timeGrid' in input) delete merged['times'];

  return merged as unknown as PlanDraft;
}

function statusOf(value: unknown): TaskStatus | undefined {
  return value === TaskStatus.DONE || value === TaskStatus.TODO ? value : undefined;
}

/**
 * PUT replaces, so the body must carry the ticks it is not changing: each step
 * keeps the status of the stored step with the same name, the way `stepsFor`
 * pairs a repeat's steps with an occurrence's.
 */
function keepTicks(payload: UpdateTask, task: Task, status: TaskStatus | undefined): UpdateTask {
  const ticks = new Map(task.subtasks.map((step: Subtask) => [step.name, step.status]));
  const subtasks = (payload.subtasks ?? []).map((step) => ({
    ...step, status: ticks.get(step.name) ?? step.status,
  }));

  return { ...payload, subtasks, status: status ?? task.status };
}

const asProblem = (number: number, caught: unknown): string => {
  if (caught instanceof InputValidationError) return `Change ${String(number)}: ${caught.message}`;
  throw caught;
};

export class AssistantChangesService {
  constructor(
    private readonly tasksService: ITasksService,
    private readonly repeatedTasksService: IRepeatedTasksService,
  ) {}

  /** The change ready to show and apply, or the reason it cannot be made. */
  async prepare(input: Fields, number: number, session: AssistantSession): Promise<PlanChange | string> {
    const id = typeof input['id'] === 'string' ? input['id'] : '';
    try {
      return input['target'] === 'repeat'
        ? await this.prepareRepeat(input, id, number, session)
        : await this.prepareTask(input, id, number, session);
    } catch (caught) {
      return asProblem(number, caught);
    }
  }

  private async prepareRepeat(input: Fields, id: string, number: number, session: AssistantSession) {
    const config = await this.repeatedTasksService.getById(id, session.userId);
    if (config === null) return `Change ${String(number)}: there is no repeat with id "${id}". Use find_repeats.`;
    if ('status' in input) return `Change ${String(number)}: a repeat has no status. Use "enabled" to pause it.`;
    if (editedKeys(input).length === 0) return `Change ${String(number)}: nothing to change.`;

    const before = configToDraft(config, session.offsetMinutes);
    const after = mergeDraft(before, input);
    const payload = buildPayload(after, session.offsetMinutes);
    const change: PlanChange = { number, target: 'repeat', id, before, after, payload, statusOnly: false };

    return change;
  }

  private async prepareTask(input: Fields, id: string, number: number, session: AssistantSession) {
    const task = await this.tasksService.getById(id, session.userId);
    if (task === null) return `Change ${String(number)}: there is no task with id "${id}". Use find_tasks.`;

    const status = statusOf(input['status']);
    const before = taskToDraft(task, session.offsetMinutes);
    if (editedKeys(input).length === 0) {
      if (status === undefined) return `Change ${String(number)}: nothing to change.`;

      // A status change goes through the status route, so there is no body to
      // send; the empty payload is never used.
      return { number, target: 'task' as const, id, before, after: before, status, statusOnly: true, payload: {} as UpdateTask };
    }
    if (task.type === TaskType.EVENT && task.configTaskId !== null) {
      return `Change ${String(number)}: this task was made by a repeat (id "${task.configTaskId}"). `
        + 'Change the repeat with target "repeat" instead; a task made by a repeat only accepts a status change.';
    }

    const after = mergeDraft(before, input);
    const payload = keepTicks(buildPayload(after, session.offsetMinutes) as UpdateTask, task, status);
    const change: PlanChange = { number, target: 'task', id, before, after, payload, statusOnly: false };
    if (status !== undefined) change.status = status;

    return change;
  }

  /** Applies an accepted change through the same service methods the API uses. */
  async apply(change: PlanChange, userId: string): Promise<CreatedItem> {
    if (change.target === 'repeat') {
      const body = structuredClone(change.payload) as PatchRepeatedTask;
      const config = await this.repeatedTasksService.patchById(change.id, userId, body);

      return { action: 'updated', resource: 'repeated-task', id: config.id, name: config.name };
    }

    const task = change.statusOnly && change.status !== undefined
      ? await this.tasksService.updateStatus(change.id, userId, change.status)
      : await this.tasksService.updateById(change.id, userId, structuredClone(change.payload) as UpdateTask);

    return { action: 'updated', resource: 'task', id: task.id, name: task.name };
  }
}
