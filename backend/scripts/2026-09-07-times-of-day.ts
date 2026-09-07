/**
 * Gives every stored config the `timesOfDay` list it now carries, and takes the
 * three window fields off the daily ones.
 *
 * Every schedule now says *which days, and at what times on them*. Before this,
 * only a daily config could name times — as a window plus a step — and weekly
 * and monthly ones shared one hardcoded hour. The honest translation:
 *
 *   daily    → the window expanded into the concrete times it produced, then
 *              `startsAt` / `endsAt` / `repeatEach` removed
 *   weekly   → the hour they were all generating at anyway
 *   monthly  → the same
 *
 * So no occurrence moves. The expansion is the same arithmetic the old
 * `dailyGridFor` did, kept here rather than imported because the function it
 * mirrors no longer exists.
 *
 * Run this **before** deploying the code that reads the field. A config without
 * it reaches `sortedTimes` as `undefined` and the poller's pass throws — the
 * pass is caught and retried, so it is recoverable, but there is no reason to
 * live through it.
 *
 * Idempotent. A config that already carries `timesOfDay` is left alone.
 *
 *   npx tsx scripts/2026-09-07-times-of-day.ts          # report only
 *   npx tsx scripts/2026-09-07-times-of-day.ts --write  # apply
 */
import { config } from '../src/config.js';
import { DEFAULT_TIME_OF_DAY } from '../src/schemes/common.schemes.js';
import { MongoStorage } from '../src/storage/mongo.storage.js';
import type { TimeOfDay } from '../src/types/repeated-tasks.types.js';

/**
 * `TaskType.REPEATED_DAILY` is the string 'DAILY', not 'REPEATED_DAILY' — the
 * one inconsistency in that enum, and it is what is actually in the documents.
 */
const DAILY = 'DAILY';

const MINUTES_PER_HOUR = 60;

const write = process.argv.includes('--write');

const asMinutes = (time: TimeOfDay): number => time.hour * MINUTES_PER_HOUR + time.minute;
const asTime = (minutes: number): TimeOfDay => ({
  hour: Math.floor(minutes / MINUTES_PER_HOUR),
  minute: minutes % MINUTES_PER_HOUR,
});
const clock = (time: TimeOfDay): string =>
  `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;

/**
 * The old daily grid: from `startsAt`, stepping by `repeatEach`, up to and
 * including `endsAt`. A window that does not divide evenly stops early, exactly
 * as it did before.
 */
function expand(startsAt: TimeOfDay, endsAt: TimeOfDay, repeatEach: TimeOfDay): TimeOfDay[] {
  const step = asMinutes(repeatEach);
  const last = asMinutes(endsAt);
  if (step <= 0 || asMinutes(startsAt) > last) return [DEFAULT_TIME_OF_DAY];

  const times: TimeOfDay[] = [];
  for (let minute = asMinutes(startsAt); minute <= last; minute += step) {
    times.push(asTime(minute));
  }

  return times;
}

/** What this document's times should become, given what it carries today. */
function timesFor(doc: Record<string, unknown>): TimeOfDay[] {
  if (doc['type'] !== DAILY) return [DEFAULT_TIME_OF_DAY];

  const startsAt = doc['startsAt'] as TimeOfDay | undefined;
  const endsAt = doc['endsAt'] as TimeOfDay | undefined;
  const repeatEach = doc['repeatEach'] as TimeOfDay | undefined;
  if (startsAt === undefined || endsAt === undefined || repeatEach === undefined) {
    return [DEFAULT_TIME_OF_DAY];
  }

  return expand(startsAt, endsAt, repeatEach);
}

const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);
const db = await storage.connect();

try {
  const collection = db.collection('repeatedTasks');
  const pending = await collection.find({ timesOfDay: { $exists: false } }).toArray();

  console.log(`database: ${config.mongoDbName}`);
  console.log(`\nconfigs without timesOfDay: ${String(pending.length)}`);

  const planned = pending.map((doc) => ({ doc, times: timesFor(doc) }));
  for (const { doc, times } of planned) {
    console.log(`  [${String(doc['type'])}] "${String(doc['name'])}"`);
    console.log(`      -> ${times.map(clock).join(' ')}`);
  }

  if (!write) {
    console.log('\ndry run. re-run with --write to apply.');
  } else {
    // One write each: the times differ per config, so there is no updateMany
    // that covers them. Issued together rather than in sequence.
    const results = await Promise.all(planned.map(({ doc, times }) => collection.updateOne(
      { _id: doc['_id'] },
      {
        $set: { timesOfDay: times },
        // The window fields are gone from the model; leaving them behind would
        // make a stored config fail the schema on its next PUT.
        $unset: { startsAt: '', endsAt: '', repeatEach: '' },
      },
    )));

    const changed = results.filter((result) => result.modifiedCount > 0).length;
    console.log(`\napplied to ${String(changed)} configs.`);
  }
} finally {
  await storage.close();
}
