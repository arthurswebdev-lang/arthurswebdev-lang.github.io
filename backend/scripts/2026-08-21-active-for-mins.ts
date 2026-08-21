/**
 * Replaces `toDay` on monthly configs with `activeForMins`, and backfills the
 * new field everywhere else.
 *
 * `toDay` was collected, validated and stored, and nothing ever read it — the
 * form promised a window it did not deliver. `activeForMins` is that window,
 * made real and made general: it applies to any dated task, not just monthly.
 *
 * A monthly config saying "days 8 to 12" becomes a window running from the
 * occurrence (day 8 at 09:00 UTC) to the end of day 12, which is 6660 minutes.
 * Not `(toDay - fromDay + 1) * 24 * 60`: that measures whole days from the
 * firing time and so runs nine hours into the 13th.
 *
 * Idempotent. Rows that already carry `activeForMins` are left alone, so a
 * re-run after a partial failure is safe.
 *
 *   npx tsx scripts/2026-08-21-active-for-mins.ts          # report only
 *   npx tsx scripts/2026-08-21-active-for-mins.ts --write  # apply
 */
import { config } from '../src/config.js';
import { DEFAULT_ACTIVE_FOR_MINS } from '../src/schemes/common.schemes.js';
import { GENERATED_EVENT_TIME } from '../src/generators/occurrences.generator.js';
import { MongoStorage } from '../src/storage/mongo.storage.js';

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Minutes from the occurrence on `fromDay` to the end of `toDay`. */
export function windowFromDayRange(fromDay: number, toDay: number): number {
  const wholeDays = toDay - fromDay;
  const fromFiringToMidnight = MINUTES_PER_DAY
    - (GENERATED_EVENT_TIME.hour * MINUTES_PER_HOUR + GENERATED_EVENT_TIME.minute);

  return wholeDays * MINUTES_PER_DAY + fromFiringToMidnight;
}

interface Plan {
  configs: { id: string; name: string; from: string; to: number }[];
  events: number;
}

async function planFor(storage: MongoStorage): Promise<Plan> {
  const db = await storage.connect();
  const configs = await db.collection('repeatedTasks')
    .find({ activeForMins: { $exists: false } }).toArray();

  const events = await db.collection('tasks')
    .countDocuments({ type: 'EVENT', activeForMins: { $exists: false } });

  return {
    configs: configs.map((doc) => ({
      id: String(doc['_id']),
      name: String(doc['name']),
      from: typeof doc['toDay'] === 'number' ? `days ${String(doc['fromDay'])}-${String(doc['toDay'])}` : 'no toDay',
      to: typeof doc['toDay'] === 'number'
        ? windowFromDayRange(Number(doc['fromDay']), doc['toDay'])
        : DEFAULT_ACTIVE_FOR_MINS,
    })),
    events,
  };
}

async function apply(storage: MongoStorage, plan: Plan): Promise<void> {
  const db = await storage.connect();
  const configs = db.collection('repeatedTasks');

  // Read once, decide from that snapshot, then write — no awaiting in a loop.
  await Promise.all(plan.configs.map((row) => configs.updateOne(
    { _id: row.id as never },
    { $set: { activeForMins: row.to }, $unset: { toDay: '' } },
  )));

  // Any config that already had the field still needs toDay gone.
  await configs.updateMany({ toDay: { $exists: true } }, { $unset: { toDay: '' } });

  // A generated event inherits its window from the config that made it, the
  // same way it inherits category and links. Giving it the default instead
  // would leave the September bill active for ten minutes while the rule it
  // came from says days — and nothing regenerates a pending event to correct
  // it, because it has not passed yet.
  const tasks = db.collection('tasks');
  const configRows = await configs.find({}).toArray();

  await Promise.all(configRows.map((row) => tasks.updateMany(
    { type: 'EVENT', configTaskId: row['_id'] },
    { $set: { activeForMins: row['activeForMins'] } },
  )));

  // Hand-made events have no config to inherit from.
  await tasks.updateMany(
    { type: 'EVENT', configTaskId: null, activeForMins: { $exists: false } },
    { $set: { activeForMins: DEFAULT_ACTIVE_FOR_MINS } },
  );
}

const write = process.argv.includes('--write');
const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);

try {
  const plan = await planFor(storage);

  console.log(`database: ${config.mongoDbName}`);
  console.log(`configs to change: ${String(plan.configs.length)}`);
  for (const row of plan.configs) {
    console.log(`  "${row.name}"  ${row.from}  ->  activeForMins ${String(row.to)}`);
  }
  console.log(`events to backfill: ${String(plan.events)} (-> ${String(DEFAULT_ACTIVE_FOR_MINS)})`);

  if (!write) {
    console.log('\ndry run. re-run with --write to apply.');
  } else {
    await apply(storage, plan);
    console.log('\napplied.');
  }
} finally {
  await storage.close();
}
