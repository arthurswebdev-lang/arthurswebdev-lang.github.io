import { TaskType } from '../enum/task-type.enum.js';
import type {
  DailyTask, MonthlyTask, RepeatedTask, TimeOfDay, WeeklyTask,
} from '../types/tasks.types.js';

/**
 * Works out *when* a repeated config's next event falls. Nothing here creates
 * or stores anything — these are pure date calculations, one rule per function,
 * so each schedule can be checked on its own.
 *
 * Everything is UTC, and every function answers the same question: given the
 * instant `after`, when is the next occurrence strictly later than it?
 */

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;

/**
 * Time of day given to events generated from weekly and monthly configs, which
 * carry no time of their own. Not midnight on purpose: a 00:00 event counts as
 * passed from the first instant of the day it belongs to, so it would never
 * read as actual on its own day.
 */
export const GENERATED_EVENT_TIME: TimeOfDay = { hour: 9, minute: 0 };

/** How many months ahead to look before giving up on a monthly config. */
const MONTHLY_SEARCH_LIMIT = MONTHS_PER_YEAR + 1;

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

// ── Is a config even usable? ───────────────────────────────────────────────

/**
 * A daily config only generates if its window runs forwards and its step moves.
 * A zero `repeatEach` would otherwise loop for ever.
 */
export function isDailyConfigUsable(config: DailyTask): boolean {
  return toMinutesOfDay(config.repeatEach) > 0
    && toMinutesOfDay(config.startsAt) <= toMinutesOfDay(config.endsAt);
}

// ── Daily ──────────────────────────────────────────────────────────────────

/**
 * Every point on one day's grid: from `startsAt`, stepping by `repeatEach`, up
 * to and including `endsAt`.
 *
 * 09:00 to 23:00 every 2h gives 09, 11, 13, 15, 17, 19, 21, 23. A window that
 * does not divide evenly simply stops early: every 4h gives 09, 13, 17, 21 and
 * never reaches 23:00.
 */
export function dailyGridFor(day: Date, config: DailyTask): Date[] {
  if (!isDailyConfigUsable(config)) return [];

  const step = toMinutesOfDay(config.repeatEach);
  const last = toMinutesOfDay(config.endsAt);
  const points: Date[] = [];

  for (let minute = toMinutesOfDay(config.startsAt); minute <= last; minute += step) {
    points.push(new Date(startOfUtcDay(day).getTime() + minute * MS_PER_MINUTE));
  }

  return points;
}

/**
 * Next pour after `after`. At 11:45 with a 2h grid from 09:00 that is 13:00;
 * at 23:01 today's grid is spent, so it rolls to tomorrow's 09:00.
 */
export function nextDailyOccurrence(config: DailyTask, after: Date): Date | null {
  if (!isDailyConfigUsable(config)) return null;

  const todaysPoint = dailyGridFor(after, config).find((point) => point > after);
  if (todaysPoint !== undefined) return todaysPoint;

  const tomorrow = new Date(startOfUtcDay(after).getTime() + MS_PER_DAY);

  return atTimeOfDay(tomorrow, config.startsAt);
}

// ── Weekly ─────────────────────────────────────────────────────────────────

/** Does this config run on the weekday `date` falls on? */
export function runsOnWeekday(config: WeeklyTask, date: Date): boolean {
  return config.weekdays.includes(date.getUTCDay());
}

/**
 * Next session after `after`, at `GENERATED_EVENT_TIME`. Checks today first, so
 * a Monday config asked at Monday 08:00 answers Monday 09:00, not next week.
 */
export function nextWeeklyOccurrence(config: WeeklyTask, after: Date): Date | null {
  if (config.weekdays.length === 0) return null;

  for (let offset = 0; offset <= DAYS_PER_WEEK; offset += 1) {
    const day = new Date(startOfUtcDay(after).getTime() + offset * MS_PER_DAY);
    const candidate = atTimeOfDay(day, GENERATED_EVENT_TIME);

    if (runsOnWeekday(config, candidate) && candidate > after) return candidate;
  }

  return null;
}

// ── Monthly ────────────────────────────────────────────────────────────────

/** Does this config run in the month `date` falls in? `months` is 1-based. */
export function runsInMonth(config: MonthlyTask, date: Date): boolean {
  return config.months.includes(date.getUTCMonth() + 1);
}

/** The occurrence inside one month: `fromDay`, clamped, at the standard time. */
export function occurrenceInMonth(config: MonthlyTask, year: number, monthIndex: number): Date {
  const day = clampDayToMonth(year, monthIndex, config.fromDay);

  return new Date(Date.UTC(year, monthIndex, day, GENERATED_EVENT_TIME.hour, GENERATED_EVENT_TIME.minute));
}

/**
 * Next occurrence after `after`, walking forward a month at a time. Only
 * `fromDay` generates; `toDay` does not affect the schedule (Q4/Q14).
 */
export function nextMonthlyOccurrence(config: MonthlyTask, after: Date): Date | null {
  if (config.months.length === 0) return null;

  for (let ahead = 0; ahead <= MONTHLY_SEARCH_LIMIT; ahead += 1) {
    const cursor = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + ahead, 1));
    const candidate = occurrenceInMonth(config, cursor.getUTCFullYear(), cursor.getUTCMonth());

    if (runsInMonth(config, candidate) && candidate > after) return candidate;
  }

  return null;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

/** The next occurrence of any repeated config, or null if it can never fire. */
export function nextOccurrence(config: RepeatedTask, after: Date): Date | null {
  switch (config.type) {
    case TaskType.REPEATED_DAILY:
      return nextDailyOccurrence(config, after);
    case TaskType.REPEATED_WEEKLY:
      return nextWeeklyOccurrence(config, after);
    case TaskType.REPEATED_MONTHLY:
      return nextMonthlyOccurrence(config, after);
  }
}
