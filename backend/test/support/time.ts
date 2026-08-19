import assert from 'node:assert/strict';

/**
 * Readable UTC dates for tests.
 *
 * Every date in the suite is built through here, so no test ever depends on the
 * machine's timezone. Writing `new Date('2026-08-22T10:00')` would be parsed as
 * *local* time and quietly shift the whole scenario when CI runs elsewhere.
 *
 * The weekday prefix is not decoration: it is asserted. A reader of a weekly
 * test has to trust that 2026-08-22 really is a Saturday, and `utc` checks it,
 * so a wrong date fails loudly instead of silently testing the wrong day.
 */

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

type WeekdayName = typeof WEEKDAY_NAMES[number];

const SPEC = /^(?:(?<weekday>Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?(?<date>\d{4}-\d{2}-\d{2})(?: (?<time>\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?))?$/;

/** The UTC weekday name of a date, e.g. 'Sat'. */
export function weekdayOf(date: Date): WeekdayName {
  const name = WEEKDAY_NAMES[date.getUTCDay()];
  assert.ok(name !== undefined, `no weekday for ${date.toISOString()}`);

  return name;
}

/**
 * Builds a UTC date from a readable spec. The weekday and time are optional;
 * a missing time means UTC midnight.
 *
 * ```ts
 * utc('2026-08-19 11:45')      // Wed 19 Aug 2026, 11:45 UTC
 * utc('Sat 2026-08-22 10:00')  // same, and asserts that day is a Saturday
 * utc('Mon 2026-08-24')        // UTC midnight
 * ```
 */
export function utc(spec: string): Date {
  const match = SPEC.exec(spec);
  assert.ok(match?.groups !== undefined, `unreadable date spec: "${spec}"`);

  const { weekday, date, time } = match.groups;
  assert.ok(date !== undefined, `unreadable date spec: "${spec}"`);

  // 'HH:MM' needs seconds to be a valid ISO instant; longer forms already have them.
  const clock = time ?? '00:00';
  const withSeconds = clock.length === 'HH:MM'.length ? `${clock}:00` : clock;

  const built = new Date(`${date}T${withSeconds}Z`);
  assert.ok(!Number.isNaN(built.getTime()), `unreadable date spec: "${spec}"`);

  if (weekday !== undefined) {
    assert.equal(
      weekdayOf(built),
      weekday,
      `${date} is a ${weekdayOf(built)}, not a ${weekday} — fix the test's date`,
    );
  }

  return built;
}

/** Same instant, expressed for a failure message: 'Sat 2026-08-22 10:00 UTC'. */
export function describeUtc(date: Date): string {
  return `${weekdayOf(date)} ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
