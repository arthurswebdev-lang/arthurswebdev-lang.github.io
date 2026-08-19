import { TaskStatus } from '../enum/task-status.enum.js';
import type { Task } from '../types/tasks.types.js';
import { isEventTask } from './tasks.filters.js';

/**
 * The order `GET /tasks` returns, one rule per function, so the list reads the
 * same everywhere without every client re-deciding it.
 *
 * The order is: what is still to do before what is finished, then the soonest
 * first, then a stable tiebreak. Dateless tasks sort after dated ones — a basic
 * task has no place on the timeline, so it sits below the ones that do.
 */

const BEFORE = -1;
const AFTER = 1;
const SAME = 0;

/** `null` for a task that has no place on the timeline. */
function timelinePosition(task: Task): number | null {
  return isEventTask(task) ? task.date.getTime() : null;
}

/** Finished work drops to the end of the list, whatever its date. */
function byUnfinishedFirst(left: Task, right: Task): number {
  const leftDone = left.status === TaskStatus.DONE;
  const rightDone = right.status === TaskStatus.DONE;
  if (leftDone === rightDone) return SAME;

  return leftDone ? AFTER : BEFORE;
}

/** Earliest date first; a task without one goes after every dated task. */
function byEarliestDate(left: Task, right: Task): number {
  const leftDate = timelinePosition(left);
  const rightDate = timelinePosition(right);
  if (leftDate === null && rightDate === null) return SAME;
  if (leftDate === null) return AFTER;
  if (rightDate === null) return BEFORE;

  return leftDate - rightDate;
}

/** The tiebreak. Ids never collide, so the order is total and stable. */
function byId(left: Task, right: Task): number {
  return left.id.localeCompare(right.id);
}

const ORDER = [byUnfinishedFirst, byEarliestDate, byId];

/** The first rule with an opinion decides. */
function compareTasks(left: Task, right: Task): number {
  for (const rule of ORDER) {
    const verdict = rule(left, right);
    if (verdict !== SAME) return verdict;
  }

  return SAME;
}

/** A sorted copy: the caller's array is left as it was. */
export function sortTasks<T extends Task>(tasks: T[]): T[] {
  return [...tasks].sort(compareTasks);
}
