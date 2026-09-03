import { TaskFilter } from '../enum/task-filter.enum.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import type { EventTask, Task } from '../types/tasks.types.js';

/**
 * Every rule behind `GET /tasks?filter=actual|passed|upcoming`, one rule per
 * function, so each case can be read and judged on its own.
 *
 * Two conventions hold throughout:
 *
 * - `now` is always passed in, never read from the clock inside a rule. That is
 *   what makes "on Saturday, Monday's event is hidden" a thing you can check.
 * - A window is a **duration from the event's own date**, never a calendar
 *   boundary. This replaced `ActiveLogic` — TODAY, THIS_WEEK and NEXT_10_DAYS,
 *   three windows that started at UTC midnight and were picked from the task's
 *   *type* rather than from the task. They could not express "show me this one
 *   hour before", they behaved differently depending on which day you asked
 *   (the weekly window shrank to a single day on a Sunday), and five weekly
 *   configs sharing a week all read as actual on Monday morning.
 * - Because every boundary is now `date ± minutes`, none of this depends on
 *   which timezone the server is in.
 */

const MS_PER_MINUTE = 60 * 1000;

// ── Telling the kinds of task apart ────────────────────────────────────────

/** Event tasks are the only ones with a date, so the only ones a filter sees. */
export function isEventTask(task: Task): task is EventTask {
  return task.type === TaskType.EVENT;
}

// ── Passed / actual / upcoming ─────────────────────────────────────────────

/**
 * The source of truth for "gone by": the date itself, not `passedDate`. The
 * poller stamps `passedDate` up to a minute late, and a filter that trusted the
 * stamp would call a just-expired event actual until the next pass.
 */
export function hasDatePassed(date: Date, now: Date): boolean {
  return date <= now;
}

/** Whether the poller has already stamped this event as passed. */
export function isMarkedPassed(event: EventTask): boolean {
  return event.passedDate !== null;
}

/**
 * The three moments an event's window is made of, one function each, so no
 * caller ever writes `date.getTime() + something * 60000` by hand.
 *
 * There are now four instants on an event — `remindAt`, `activeFrom`, `date`
 * and `activeUntil` — and picking the wrong one is the easiest mistake in this
 * file. `hasDatePassed` and `isPassedEvent` were a single function once, and
 * splitting them is what fixed a real bug; these carry the same risk.
 */

/** When the reminder is sent. Equal to `date` when `remindBeforeMins` is 0. */
export function remindAt(event: EventTask): Date {
  return new Date(event.date.getTime() - event.remindBeforeMins * MS_PER_MINUTE);
}

/** When it stops being upcoming and starts being actual. */
export function activeFrom(event: EventTask): Date {
  return new Date(event.date.getTime() - event.activeBeforeMins * MS_PER_MINUTE);
}

/**
 * When it stops being worth acting on: its moment plus the time it was given to
 * be dealt with.
 *
 * `activeForMins` is why a task no longer goes to Passed the same minute it is
 * announced. A reminder is least useful at exactly the point it used to
 * disappear — you are notified, and the thing you were notified about is
 * already filed under "missed".
 */
export function activeUntil(event: EventTask): Date {
  return new Date(event.date.getTime() + event.activeForMins * MS_PER_MINUTE);
}

/**
 * Spent: its window has closed. Note this is *not* `hasDatePassed` — the two
 * were one function until events gained a window of their own, and they answer
 * different questions. Generation asks whether the moment has gone by, so that
 * the next occurrence can be made; the list asks whether the user can still do
 * anything about it.
 */
export function isPassedEvent(event: EventTask, now: Date): boolean {
  return now > activeUntil(event);
}

/**
 * Worth acting on now: inside the window the task asked for, on both sides.
 *
 * One interval, so the three filters partition the timeline exactly — before
 * `activeFrom` is upcoming, after `activeUntil` is passed, and everything in
 * between is actual, with no instant belonging to two of them or to none.
 */
export function isActualEvent(event: EventTask, now: Date): boolean {
  return now >= activeFrom(event) && !isPassedEvent(event, now);
}

/** Still ahead, and too far out to be worth showing as actual yet. */
export function isUpcomingEvent(event: EventTask, now: Date): boolean {
  return now < activeFrom(event);
}

/**
 * Nothing has happened to this occurrence yet — not finished, not a single step
 * ticked. It holds no record of anything, so it can be rewritten or thrown away
 * without losing what someone did.
 *
 * This is the line between an occurrence that is still just a plan and one that
 * has become history, and it is what stops editing a repeat from erasing the
 * sessions you already worked through.
 */
export function isUnstartedEvent(event: EventTask): boolean {
  return event.status === TaskStatus.TODO
    && event.subtasks.every((step) => step.status !== TaskStatus.DONE);
}

/**
 * Can this occurrence still be brought in line with its config?
 *
 * Weaker than `isUnstartedEvent` on purpose, and the two are used for different
 * things. Throwing an occurrence *away* needs it to hold no record of anything.
 * Rewriting one in place only needs it to still be ahead of you: correcting a
 * repeat from 30kg to 35kg has to reach the session you are halfway through,
 * because that session is exactly the one you are about to do at 35kg. What it
 * must not reach is a session that is over — finished, or with its window shut
 * — because that is a record of what actually happened at 30kg, and today's
 * correction does not change what you lifted last week.
 */
export function isRewritableEvent(event: EventTask, now: Date): boolean {
  return event.status !== TaskStatus.DONE && !isPassedEvent(event, now);
}

/** Was this event produced by a repeated config, rather than by a client? */
export function isGeneratedEvent(event: EventTask): boolean {
  return event.configTaskId !== null;
}

/** All events a given config has produced so far. */
export function eventsOfConfig(tasks: Task[], configTaskId: string): EventTask[] {
  return tasks.filter(isEventTask).filter((event) => event.configTaskId === configTaskId);
}

/**
 * The one event a config is currently waiting on: generated by it, its moment
 * not yet gone by. The generator's invariant is that there is at most one.
 *
 * Deliberately `hasDatePassed` and not `isPassedEvent`. Keying this off the
 * window instead would hold the next occurrence back for the length of the
 * window, and a config that repeats more often than its window is long would
 * quietly skip occurrences — every two hours with a three-hour window would
 * yield 09:00, 13:00, 17:00 and never 11:00.
 */
export function pendingEventOfConfig(
  tasks: Task[],
  configTaskId: string,
  now: Date,
): EventTask | null {
  return eventsOfConfig(tasks, configTaskId)
    .find((event) => !hasDatePassed(event.date, now)) ?? null;
}

// ── Applying a filter to a list ────────────────────────────────────────────

/**
 * A filter names a position in time. A task with no date has none: nothing
 * makes it pass and nothing makes it wait, so it is always relevant and
 * belongs under `actual`. Leaving it out of every filter would make a plain
 * to-do invisible in an app whose list is always filtered.
 */
export function matchesTaskFilter(task: Task, filter: TaskFilter, now: Date): boolean {
  if (!isEventTask(task)) return filter === TaskFilter.ACTUAL;

  switch (filter) {
    case TaskFilter.PASSED:
      return isPassedEvent(task, now);
    case TaskFilter.ACTUAL:
      return isActualEvent(task, now);
    case TaskFilter.UPCOMING:
      return isUpcomingEvent(task, now);
  }
}

/** Entry point: no filter means the whole list, basic tasks included. */
export function filterTasks(tasks: Task[], filter: TaskFilter | undefined, now: Date): Task[] {
  if (filter === undefined) return tasks;

  return tasks.filter((task) => matchesTaskFilter(task, filter, now));
}
