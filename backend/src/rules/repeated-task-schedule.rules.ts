import { TaskType } from '../enum/task-type.enum.js';
import { toMinutesOfDay } from '../generators/occurrences.generator.js';
import type { RepeatedTask } from '../types/repeated-tasks.types.js';

/**
 * Which fields decide *when* a config's occurrences fall, and nothing else.
 *
 * This is the line an update is judged against. Change a weekday and every
 * occurrence the config has waiting is on the wrong date, so it has to be made
 * again. Change the name, the links, the steps or the window and every date is
 * still right — the occurrences just need the new values, which is a rewrite in
 * place rather than a delete.
 *
 * Getting that distinction wrong is expensive in one direction only: treating a
 * schedule change as cosmetic leaves occurrences on dates the rule no longer
 * produces, while treating a cosmetic change as a schedule change used to throw
 * away finished sessions.
 */

/**
 * A config's schedule as one comparable string.
 *
 * Deliberately not a deep-equality check on the whole config: that would count
 * a renamed task as a moved one. Times go through `toMinutesOfDay` and lists
 * are sorted, so `[5, 1]` and `[1, 5]` are the same Monday-and-Friday schedule
 * and neither key order nor the order someone tapped the days in matters.
 */
export function scheduleOf(config: RepeatedTask): string {
  const ascending = (a: number, b: number) => a - b;

  switch (config.type) {
    case TaskType.REPEATED_DAILY:
      return `daily:${String(toMinutesOfDay(config.startsAt))}`
        + `-${String(toMinutesOfDay(config.endsAt))}`
        + `/${String(toMinutesOfDay(config.repeatEach))}`;
    case TaskType.REPEATED_WEEKLY:
      return `weekly:${[...config.weekdays].sort(ascending).join(',')}`;
    case TaskType.REPEATED_MONTHLY:
      return `monthly:${String(config.fromDay)}`
        + `@${[...config.months].sort(ascending).join(',')}`;
  }
}

/** Do these two versions of a config produce occurrences on different dates? */
export function scheduleMoved(before: RepeatedTask, after: RepeatedTask): boolean {
  return scheduleOf(before) !== scheduleOf(after);
}
