import { TaskCategory } from '../../src/enum/task-category.enum.js';
import { TaskStatus } from '../../src/enum/task-status.enum.js';
import { TaskType } from '../../src/enum/task-type.enum.js';
import {
  ALL_WEEKDAYS, DEFAULT_ACTIVE_BEFORE_MINS, DEFAULT_ACTIVE_FOR_MINS, DEFAULT_REMIND_BEFORE_MINS,
  DEFAULT_TIME_OF_DAY,
} from '../../src/schemes/common.schemes.js';
import type { BasicTask, EventTask } from '../../src/types/tasks.types.js';
import type { DailyTask, MonthlyTask, TimeOfDay, WeeklyTask } from '../../src/types/repeated-tasks.types.js';
import { utc } from './time.js';

/**
 * Task builders for tests. Each takes only what the scenario cares about, so a
 * test names the date and the window and nothing else competes for attention.
 */

const CREATED_AT = utc('2026-08-01');

const MINS_PER_HOUR = 60;
const MINS_PER_DAY = 24 * MINS_PER_HOUR;

/** Every fixture belongs to the same person unless a test says otherwise. */
export const TEST_USER_ID = 'user-1';

/** Minutes, written the way a test wants to read them. */
export const hours = (count: number): number => count * MINS_PER_HOUR;
export const days = (count: number): number => count * MINS_PER_DAY;

/** An event due at `date`, with the default window unless a test says more. */
export function anEvent(
  name: string,
  date: string,
  overrides: Partial<EventTask> = {},
): EventTask {
  return {
    id: `event-${name}`,
    userId: TEST_USER_ID,
    type: TaskType.EVENT,
    status: TaskStatus.TODO,
    name,
    createdAt: CREATED_AT,
    category: TaskCategory.OTHER,
    links: [],
    subtasks: [],
    date: utc(date),
    remindBeforeMins: DEFAULT_REMIND_BEFORE_MINS,
    activeBeforeMins: DEFAULT_ACTIVE_BEFORE_MINS,
    activeForMins: DEFAULT_ACTIVE_FOR_MINS,
    passedDate: null,
    notifiedAt: null,
    configTaskId: 'config-1',
    ...overrides,
  };
}

/**
 * An event with an explicit window, in minutes either side of its date. The
 * shorthand most window tests want: `anEventWindowed('gym', d, hours(1), hours(3))`.
 */
export function anEventWindowed(
  name: string,
  date: string,
  activeBeforeMins: number,
  activeForMins: number,
  overrides: Partial<EventTask> = {},
): EventTask {
  return anEvent(name, date, { activeBeforeMins, activeForMins, ...overrides });
}

/** An event a client created directly, with no config behind it. */
export function aHandMadeEvent(
  name: string,
  date: string,
  overrides: Partial<EventTask> = {},
): EventTask {
  return anEvent(name, date, { configTaskId: null, ...overrides });
}

export function aBasicTask(name: string): BasicTask {
  return {
    id: `basic-${name}`,
    userId: TEST_USER_ID,
    type: TaskType.BASIC,
    status: TaskStatus.TODO,
    name,
    createdAt: CREATED_AT,
    category: TaskCategory.OTHER,
    links: [],
    subtasks: [],
  };
}

export function aWeeklyConfig(
  name: string,
  weekdays: number[],
  overrides: Partial<WeeklyTask> = {},
): WeeklyTask {
  return {
    id: `config-${name}`,
    userId: TEST_USER_ID,
    type: TaskType.REPEATED_WEEKLY,
    name,
    createdAt: CREATED_AT,
    category: TaskCategory.OTHER,
    links: [],
    remindBeforeMins: DEFAULT_REMIND_BEFORE_MINS,
    activeBeforeMins: DEFAULT_ACTIVE_BEFORE_MINS,
    activeForMins: DEFAULT_ACTIVE_FOR_MINS,
    subtasks: [],
    timesOfDay: [DEFAULT_TIME_OF_DAY],
    enabled: true,
    weekdays,
    ...overrides,
  };
}

/** '09:30' becomes { hour: 9, minute: 30 } — readable schedules in tests. */
export function timeOfDay(clock: string): TimeOfDay {
  const [hour, minute] = clock.split(':').map(Number);

  return { hour: hour ?? 0, minute: minute ?? 0 };
}

/**
 * Every point between two clock times, stepping by a gap — what the form's
 * "every N hours" mode produces before it is sent.
 *
 * `hourlyBetween('09:00', '15:00', '02:00')` gives 09:00, 11:00, 13:00, 15:00.
 */
export function hourlyBetween(from: string, until: string, every: string): TimeOfDay[] {
  const asMinutes = (clock: string) => {
    const at = timeOfDay(clock);

    return at.hour * 60 + at.minute;
  };
  const step = asMinutes(every);
  const last = asMinutes(until);
  const times: TimeOfDay[] = [];

  for (let minute = asMinutes(from); minute <= last; minute += step) {
    times.push({ hour: Math.floor(minute / 60), minute: minute % 60 });
  }

  return times;
}

/** Runs every day unless the scenario names the days it cares about. */
export function aDailyConfig(
  name: string,
  schedule: { timesOfDay: TimeOfDay[]; weekdays?: number[] },
): DailyTask {
  return {
    id: `config-${name}`,
    userId: TEST_USER_ID,
    type: TaskType.REPEATED_DAILY,
    name,
    createdAt: CREATED_AT,
    category: TaskCategory.OTHER,
    links: [],
    remindBeforeMins: DEFAULT_REMIND_BEFORE_MINS,
    activeBeforeMins: DEFAULT_ACTIVE_BEFORE_MINS,
    activeForMins: DEFAULT_ACTIVE_FOR_MINS,
    subtasks: [],
    timesOfDay: schedule.timesOfDay,
    enabled: true,
    weekdays: schedule.weekdays ?? ALL_WEEKDAYS,
  };
}

export function aMonthlyConfig(
  name: string,
  schedule: { fromDay: number; months: number[]; timesOfDay?: TimeOfDay[] },
): MonthlyTask {
  return {
    id: `config-${name}`,
    userId: TEST_USER_ID,
    type: TaskType.REPEATED_MONTHLY,
    name,
    createdAt: CREATED_AT,
    category: TaskCategory.OTHER,
    links: [],
    remindBeforeMins: DEFAULT_REMIND_BEFORE_MINS,
    activeBeforeMins: DEFAULT_ACTIVE_BEFORE_MINS,
    activeForMins: DEFAULT_ACTIVE_FOR_MINS,
    subtasks: [],
    timesOfDay: [DEFAULT_TIME_OF_DAY],
    enabled: true,
    ...schedule,
  };
}
