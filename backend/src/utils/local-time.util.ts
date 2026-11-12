import type { TimeOfDay } from '../types/repeated-tasks.types.js';
import type { TimeGrid } from '../types/assistant.types.js';

/**
 * The person's clock and the server's UTC, converted in one place.
 *
 * The assistant's model only ever speaks local time: it is reliable at "12:00,
 * 14:00, 16:00" and unreliable at subtracting an offset from each and wrapping
 * the day. `offsetMinutes` is the browser's `getTimezoneOffset()` — minutes to
 * *add* to local time to get UTC, so -240 in Yerevan.
 */

const MINUTES_PER_DAY = 24 * 60;

const CLOCK = /^(\d{1,2}):(\d{2})$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})$/;

/** `HH:mm` to minutes after midnight, or `null` when it is not a clock time. */
export function parseClock(text: string): number | null {
  const match = CLOCK.exec(text.trim());
  if (match === null) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return hour * 60 + minute;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Minutes after midnight back to `HH:mm`. */
export const formatClock = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * A local time of day in UTC, and how many days it moved.
 *
 * The move is the trap: 01:00 Monday in Yerevan is 21:00 *Sunday* UTC, so a
 * weekly rule stored as 21:00 on Monday would fire a day late, every week,
 * silently. The caller applies `dayShift` to the weekdays or the day of month.
 */
export function toUtcTime(localMinutes: number, offsetMinutes: number) {
  const utc = localMinutes + offsetMinutes;
  const dayShift = Math.floor(utc / MINUTES_PER_DAY);
  const wrapped = utc - dayShift * MINUTES_PER_DAY;
  const time: TimeOfDay = { hour: Math.floor(wrapped / 60), minute: wrapped % 60 };

  return { time, dayShift };
}

/**
 * "Every 2h from 09:00 until 21:00" as the times it means, the last included
 * when it lands exactly. The same arithmetic as `expandWindow` in
 * frontend/app.js, so the composer's window mode and the assistant agree.
 */
export function expandGrid(grid: TimeGrid): number[] | null {
  const from = parseClock(grid.from);
  const until = parseClock(grid.until);
  const every = parseClock(grid.every);
  if (from === null || until === null || every === null || every <= 0 || from > until) {
    return null;
  }

  const times: number[] = [];
  for (let minute = from; minute <= until; minute += every) times.push(minute);

  return times;
}

/** `YYYY-MM-DDTHH:mm` on the person's clock to the instant it names. */
export function localDateToUtc(text: string, offsetMinutes: number): Date | null {
  const match = LOCAL_DATE.exec(text.trim());
  if (match === null) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  if (year === undefined || month === undefined || day === undefined
    || hour === undefined || minute === undefined) return null;

  // The parts are read as if they were UTC, then moved by the offset: no
  // dependence on the server's own timezone anywhere.
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(naive + offsetMinutes * 60_000);

  return new Date(naive).getUTCDate() === day ? date : null;
}

/** The person's clock, right now, as a sentence the model can read. */
export function describeNow(now: Date, offsetMinutes: number): string {
  const local = new Date(now.getTime() - offsetMinutes * 60_000);
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(local);
  const clock = formatClock(local.getUTCHours() * 60 + local.getUTCMinutes());
  const east = -offsetMinutes;
  const sign = east >= 0 ? '+' : '-';
  const zone = `UTC${sign}${formatClock(Math.abs(east))}`;

  return `Now it is ${day}, ${clock} on the person's clock (${zone}).`;
}
