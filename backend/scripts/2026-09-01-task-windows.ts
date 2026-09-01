/**
 * Replaces `activeLogic` with the two duration fields that surround it, and
 * gives every event the `notifiedAt` stamp the poller now reads.
 *
 * `activeLogic` was one of TODAY, THIS_WEEK or NEXT_10_DAYS — calendar windows
 * that began at UTC midnight and were chosen from the task's *type* rather than
 * from the task. `activeBeforeMins` is the same idea as a plain duration, so it
 * can say "one hour before" as easily as "ten days", and `remindBeforeMins`
 * splits out the question the old field could not ask at all: when do you want
 * telling, as opposed to when do you want to see it.
 *
 * The mapping is approximate on purpose. THIS_WEEK meant "from the start of
 * this week until the coming Sunday", which is not a fixed length — that
 * awkwardness is exactly why it is going. Seven days is the closest honest
 * reading; nothing depends on it being exact, because the point of the change
 * is that each task now says what it wants.
 *
 *   TODAY        -> 1 day     NEXT_10_DAYS -> 10 days
 *   THIS_WEEK    -> 7 days    remindBeforeMins -> 0, everywhere
 *
 * A zero lead keeps exactly today's behaviour: the alert lands on the moment
 * itself, which is what the app did before the field existed. Nobody is
 * surprised by a notification arriving early because of a migration.
 *
 * `notifiedAt` is backfilled rather than left null, and that matters. The
 * poller now announces any event whose reminder moment has arrived and whose
 * stamp is still empty — so migrating everything to null would make the first
 * pass after deploy re-announce every event that has already been and gone but
 * whose window is still open. An event whose date is in the past would have
 * been announced under the old rules, so it is stamped with its own date.
 *
 * Idempotent. Rows that already carry `activeBeforeMins` are left alone.
 *
 *   npx tsx scripts/2026-09-01-task-windows.ts          # report only
 *   npx tsx scripts/2026-09-01-task-windows.ts --write  # apply
 */
import type { Db } from 'mongodb';

import { config } from '../src/config.js';
import {
  DEFAULT_ACTIVE_BEFORE_MINS, DEFAULT_REMIND_BEFORE_MINS,
} from '../src/schemes/common.schemes.js';
import { MongoStorage } from '../src/storage/mongo.storage.js';

const MINS_PER_DAY = 24 * 60;

/** What each retired calendar window is worth as a plain lead time. */
const LEAD_FOR_LOGIC: Record<string, number> = {
  TODAY: MINS_PER_DAY,
  THIS_WEEK: 7 * MINS_PER_DAY,
  NEXT_10_DAYS: 10 * MINS_PER_DAY,
};

/**
 * A config never stored `activeLogic` — it was derived from the config's *type*
 * by `activeLogicForRepeatedTask`, which is gone. This is that function, kept
 * just long enough to translate what the configs used to imply.
 */
const LEAD_FOR_CONFIG_TYPE: Record<string, number> = {
  REPEATED_DAILY: LEAD_FOR_LOGIC['TODAY'] ?? MINS_PER_DAY,
  REPEATED_WEEKLY: LEAD_FOR_LOGIC['THIS_WEEK'] ?? MINS_PER_DAY,
  REPEATED_MONTHLY: LEAD_FOR_LOGIC['NEXT_10_DAYS'] ?? MINS_PER_DAY,
};

function leadFor(activeLogic: unknown): number {
  return LEAD_FOR_LOGIC[String(activeLogic)] ?? DEFAULT_ACTIVE_BEFORE_MINS;
}

function leadForConfig(type: unknown): number {
  return LEAD_FOR_CONFIG_TYPE[String(type)] ?? DEFAULT_ACTIVE_BEFORE_MINS;
}

interface Row {
  id: string;
  name: string;
  from: string;
  lead: number;
  /** Only events carry a stamp; a config has no moment to be announced at. */
  notified: Date | null;
}

interface Plan {
  configs: Row[];
  events: Row[];
}

async function planFor(db: Db, now: Date): Promise<Plan> {
  const untouched = { activeBeforeMins: { $exists: false } };

  const configs = await db.collection('repeatedTasks').find(untouched).toArray();
  const events = await db.collection('tasks').find({ type: 'EVENT', ...untouched }).toArray();

  return {
    configs: configs.map((doc) => ({
      id: String(doc['_id']),
      name: String(doc['name']),
      from: String(doc['type']),
      lead: leadForConfig(doc['type']),
      notified: null,
    })),
    events: events.map((doc) => {
      const date = doc['date'] as Date;

      return {
        id: String(doc['_id']),
        name: String(doc['name']),
        from: String(doc['activeLogic'] ?? 'no activeLogic'),
        lead: leadFor(doc['activeLogic']),
        // Already been and gone, so the old poller had its chance to announce
        // it. Stamping it stops the new poller treating it as owed a reminder.
        notified: date <= now ? date : null,
      };
    }),
  };
}

/** One update per row, all issued together — no awaiting inside a loop. */
function writeAll(db: Db, collection: string, rows: Row[]): Promise<unknown>[] {
  const target = db.collection(collection);

  return rows.map((row) => target.updateOne(
    { _id: row.id as never },
    {
      $set: {
        remindBeforeMins: DEFAULT_REMIND_BEFORE_MINS,
        activeBeforeMins: row.lead,
        ...(collection === 'tasks' ? { notifiedAt: row.notified } : {}),
      },
      $unset: { activeLogic: '' },
    },
  ));
}

async function apply(db: Db, plan: Plan): Promise<void> {
  await Promise.all([
    ...writeAll(db, 'repeatedTasks', plan.configs),
    ...writeAll(db, 'tasks', plan.events),
  ]);

  // Rows that already had the new fields may still carry the retired one.
  await Promise.all([
    db.collection('repeatedTasks').updateMany({ activeLogic: { $exists: true } }, { $unset: { activeLogic: '' } }),
    db.collection('tasks').updateMany({ activeLogic: { $exists: true } }, { $unset: { activeLogic: '' } }),
    db.collection('tasks').updateMany(
      { type: 'EVENT', notifiedAt: { $exists: false } },
      { $set: { notifiedAt: null } },
    ),
  ]);
}

const write = process.argv.includes('--write');
const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);

// Connect once and pass the Db around; see the note in the activeForMins script.
const db = await storage.connect();

const asDays = (mins: number) => `${String(mins / MINS_PER_DAY)}d`;

try {
  const plan = await planFor(db, new Date());

  console.log(`database: ${config.mongoDbName}`);
  console.log(`\nconfigs to migrate: ${String(plan.configs.length)}`);
  for (const row of plan.configs) {
    console.log(`  "${row.name}"  ${row.from}  ->  activeBefore ${asDays(row.lead)}, remind 0`);
  }

  console.log(`\nevents to migrate: ${String(plan.events.length)}`);
  const stamped = plan.events.filter((row) => row.notified !== null).length;
  for (const row of plan.events) {
    const mark = row.notified === null ? 'awaiting its reminder' : 'already announced';
    console.log(`  "${row.name}"  ${row.from}  ->  activeBefore ${asDays(row.lead)}  (${mark})`);
  }
  console.log(`\n${String(stamped)} of those are stamped as already announced.`);

  if (!write) {
    console.log('\ndry run. re-run with --write to apply.');
  } else {
    await apply(db, plan);
    console.log('\napplied.');
  }
} finally {
  await storage.close();
}
