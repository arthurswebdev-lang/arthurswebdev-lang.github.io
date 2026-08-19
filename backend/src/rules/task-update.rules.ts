import { isEventTask, isGeneratedEvent } from '../filters/tasks.filters.js';
import type { Task } from '../types/tasks.types.js';
import { InputValidationError } from '../utils/http-errors/input-validation.error.js';

/**
 * What a client is allowed to change, and where.
 *
 * A generated event is a projection of its config: name, date and active logic
 * all come from the config, and the next regeneration overwrites anything typed
 * over them. So it accepts no replacement at all — only its status moves, and
 * only through `PATCH /tasks/:id/status`. Everything else is edited on the
 * config, which regenerates.
 *
 * Configs have no status of their own to guard: they are rules, not to-dos, so
 * the field simply does not exist on them.
 */

/** Guards `PUT /tasks/:id`. */
export function assertTaskReplaceAllowed(current: Task): void {
  if (!isEventTask(current) || !isGeneratedEvent(current)) return;

  throw new InputValidationError(
    'A generated event cannot be replaced: its name, date and active logic come from its '
    + `repeated task (${String(current.configTaskId)}), which regenerates them. `
    + 'Use PATCH /tasks/:id/status to change its status, or edit the repeated task.',
    ['generatedEvent'],
  );
}
