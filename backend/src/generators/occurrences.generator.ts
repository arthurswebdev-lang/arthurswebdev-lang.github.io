import { TaskType } from '../enum/task-type.enum.js';
import type { MonthlyTask, RepeatedTask, TimeOfDay } from '../types/repeated-tasks.types.js';

/**
 * Works out *when* a repeated config's next event falls. Nothing here creates
 * or stores anything — these are pure date calculations, so each schedule can
 * be checked on its own.
 *
 * Everything is UTC, and every function answers the same question: given the
 * instant `after`, when is the next occurrence strictly later than it?
 *
 * Every config is now the same shape of question — *which days, and at what
 * times on them* — so there is one search rather than three. A schedule
 * contributes only its answer to "does it run on this day"; the times come from
 * `timesOfDay`, which all three carry.
 */

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const DAYS_PER_WEEK = 7;

/**
 * How far ahead to look before giving up.
 *
 * Eight days come back round to any weekday, today included. A monthly config
 * may run in one month a year, so it needs a full year plus the longest month
 * to be sure of finding the next one.
 */
const WEEKDAY_SEARCH_DAYS = DAYS_PER_WEEK + 1;
const MONTHLY_SEARCH_DAYS = 366 + 31;

// ── Small conversions ──────────────────────────────────────────────────────

/** 09:30 becomes 570. */
export function toMinutesOfDay(time: TimeOfDay): number {
  return time.hour * MINUTES_PER_HOUR + time.minute;
}

/** UTC midnight starting the day `date` falls in. */
export function startOfUtcDay(date: Date): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);

  return start;
}

/** That day at that time of day, UTC. */
export function atTimeOfDay(day: Date, time: TimeOfDay): Date {
  return new Date(startOfUtcDay(day).getTime() + toMinutesOfDay(time) * MS_PER_MINUTE);
}

/** Days in the month `date` falls in: 28, 29, 30 or 31. */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * `fromDay` 31 in a 30-day month lands on the 30th rather than spilling into
 * the next month.
 */
export function clampDayToMonth(year: number, monthIndex: number, day: number): number {
  return Math.min(day, daysInMonth(year, monthIndex));
}

/**
 * The config's times, in order and without repeats.
 *
 * The repository stores them sorted already; sorting again here costs nothing
 * and means generation cannot be thrown off by a row written before it did.
 */
export function sortedTimes(config: RepeatedTask): TimeOfDay[] {
  const seen = new Set<number>();

  return [...config.timesOfDay]
    .sort((a, b) => toMinutesOfDay(a) - toMinutesOfDay(b))
    .filter((time) => {
      const minutes = toMinutesOfDay(time);
      if (seen.has(minutes)) return false;
      seen.add(minutes);

      return true;
    });
}

// ── Which days does a schedule run on? ─────────────────────────────────────

/**
 * The weekday of `day`, read in UTC — the same as every other date decision
 * here, and the right reading for the one timezone this app is used in.
 */
export function runsOnWeekday(weekdays: number[], day: Date): boolean {
  return weekdays.includes(day.getUTCDay());
}

/** Does this config run in the month `day` falls in? `months` is 1-based. */
export function runsInMonth(config: MonthlyTask, day: Date): boolean {
  return config.months.includes(day.getUTCMonth() + 1);
}

/** Is `day` the day of the month this config picks out, short months clamped? */
export function isChosenDayOfMonth(config: MonthlyTask, day: Date): boolean {
  const wanted = clampDayToMonth(day.getUTCFullYear(), day.getUTCMonth(), config.fromDay);

  return day.getUTCDate() === wanted;
}

/** The one question a schedule answers about a given day. */
export function runsOnDay(config: RepeatedTask, day: Date): boolean {
  switch (config.type) {
    case TaskType.REPEATED_DAILY:
    case TaskType.REPEATED_WEEKLY:
      return runsOnWeekday(config.weekdays, day);
    case TaskType.REPEATED_MONTHLY:
      return runsInMonth(config, day) && isChosenDayOfMonth(config, day);
  }
}

/** How far this kind of schedule may have to be searched. */
function searchDays(config: RepeatedTask): number {
  return config.type === TaskType.REPEATED_MONTHLY
    ? MONTHLY_SEARCH_DAYS
    : WEEKDAY_SEARCH_DAYS;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

/**
 * The next occurrence of any repeated config, or null if it can never fire.
 *
 * Walks a day at a time from the day `after` falls in — today included, so a
 * config asked at 08:00 about a 09:00 time answers today rather than tomorrow —
 * and takes the first of that day's times still ahead. A day the schedule does
 * not run on is skipped whole.
 */
export function nextOccurrence(config: RepeatedTask, after: Date): Date | null {
  const times = sortedTimes(config);
  if (times.length === 0) return null;

  const from = startOfUtcDay(after).getTime();

  for (let offset = 0; offset <= searchDays(config); offset += 1) {
    const day = new Date(from + offset * MS_PER_DAY);
    if (!runsOnDay(config, day)) continue;

    const point = times.map((time) => atTimeOfDay(day, time)).find((candidate) => candidate > after);
    if (point !== undefined) return point;
  }

  return null;
}
