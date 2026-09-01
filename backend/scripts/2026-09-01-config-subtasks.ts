/**
 * Backfills `subtasks` on repeated configs, and clears the pending weekly and
 * monthly events so they are regenerated at the new time of day.
 *
 * Two changes landed together and both need the stored data moved:
 *
 * 1. A config now carries a checklist that every occurrence it makes starts
 *    with. `createGeneratedEvent` reads `config.subtasks` directly, so a config
 *    stored before this field existed would throw on the very next poll. This
 *    is the part that is not optional.
 *
 * 2. `GENERATED_EVENT_TIME` moved from 09:00 to 02:00 UTC — 13:00 to 06:00 in
 *    Yerevan. Nothing rewrites an event that has already been generated, so the
 *    occurrence already waiting in the list would keep the old hour until it
 *    passed of its own accord, which for a monthly config is up to a month.
 *
 * The second part deletes rather than rewrites, because deleting is the
 * direction this codebase already treats as safe: a config with no pending
 * event is topped back up by the next `syncPendingEvents`, whereas a rewritten
 * date is a guess about which events were meant to move.
 *
 * Only *untouched* events are cleared — still TODO, no step ticked. Finishing
 * an occurrence early is a supported thing to do, and deleting a done event
 * would resurrect it as a fresh to-do. Anything skipped is named in the report.
 *
 * Idempotent. Configs that already have `subtasks` are left alone, and a second
 * run finds nothing to clear because the poller has already refilled at the new
 * time.
 *
 *   npx tsx scripts/2026-09-01-config-subtasks.ts          # report only
 *   npx tsx scripts/2026-09-01-config-subtasks.ts --write  # apply
 */
import type { Db, Document } from 'mongodb';

import { config } from '../src/config.js';
import { GENERATED_EVENT_TIME } from '../src/generators/occurrences.generator.js';
import { MongoStorage } from '../src/storage/mongo.storage.js';

/** The configs whose occurrences carry no time of their own, so moved. */
const RETIMED_TYPES = ['REPEATED_WEEKLY', 'REPEATED_MONTHLY'];

interface Plan {
  /** Configs stored before `subtasks` existed. */
  needingSubtasks: { id: string; name: string }[];
  /** Pending occurrences to drop, so the poller remakes them at the new hour. */
  clearing: { id: string; name: string; date: Date }[];
  /** Pending occurrences left alone because someone has already started them. */
  keeping: { id: string; name: string; why: string }[];
}

function startedAlready(event: Document): string | null {
  if (event['status'] !== 'TODO') return `status is ${String(event['status'])}`;

  const steps = Array.isArray(event['subtasks']) ? (event['subtasks'] as Document[]) : [];
  const ticked = steps.filter((step) => step['status'] === 'DONE').length;

  return ticked === 0 ? null : `${String(ticked)} step(s) already ticked`;
}

async function planFor(db: Db, now: Date): Promise<Plan> {
  const configs = await db.collection('repeatedTasks').find({}).toArray();
  const retimed = configs.filter((row) => RETIMED_TYPES.includes(String(row['type'])));

  // Still ahead, so still the occurrence the list is showing. A passed one is
  // history and keeps the hour it actually fired at.
  const pending = await db.collection('tasks').find({
    type: 'EVENT',
    // `_id` is a uuid string here, not an ObjectId — see the note in CLAUDE.md.
    configTaskId: { $in: retimed.map((row) => String(row['_id'])) },
    date: { $gt: now },
  }).toArray();

  const plan: Plan = { needingSubtasks: [], clearing: [], keeping: [] };

  for (const row of configs.filter((each) => !Array.isArray(each['subtasks']))) {
    plan.needingSubtasks.push({ id: String(row['_id']), name: String(row['name']) });
  }

  for (const event of pending) {
    const why = startedAlready(event);
    const summary = { id: String(event['_id']), name: String(event['name']) };

    if (why === null) plan.clearing.push({ ...summary, date: event['date'] as Date });
    else plan.keeping.push({ ...summary, why });
  }

  return plan;
}

async function apply(db: Db, plan: Plan): Promise<void> {
  // Read once, decide from that snapshot, then write — no awaiting in a loop.
  await Promise.all([
    db.collection('repeatedTasks').updateMany(
      { _id: { $in: plan.needingSubtasks.map((row) => row.id) } as never },
      { $set: { subtasks: [] } },
    ),
    db.collection('tasks').deleteMany(
      { _id: { $in: plan.clearing.map((row) => row.id) } as never },
    ),
  ]);
}

const write = process.argv.includes('--write');
const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);

// Connect once and pass the Db around; see the note in the activeForMins script.
const db = await storage.connect();

try {
  const plan = await planFor(db, new Date());
  const hour = `${String(GENERATED_EVENT_TIME.hour).padStart(2, '0')}:`
    + `${String(GENERATED_EVENT_TIME.minute).padStart(2, '0')} UTC`;

  console.log(`database: ${config.mongoDbName}`);
  console.log(`\nconfigs gaining an empty checklist: ${String(plan.needingSubtasks.length)}`);
  for (const row of plan.needingSubtasks) console.log(`  "${row.name}"`);

  console.log(`\npending occurrences to clear (regenerated at ${hour}): ${String(plan.clearing.length)}`);
  for (const row of plan.clearing) console.log(`  "${row.name}"  ${row.date.toISOString()}`);

  console.log(`\nleft alone because they were already started: ${String(plan.keeping.length)}`);
  for (const row of plan.keeping) console.log(`  "${row.name}"  — ${row.why}`);

  if (!write) {
    console.log('\ndry run. re-run with --write to apply.');
  } else {
    await apply(db, plan);
    console.log('\napplied. the next poll refills what was cleared.');
  }
} finally {
  await storage.close();
}
