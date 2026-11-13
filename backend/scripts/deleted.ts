/**
 * The bin: what has been deleted, and how to put it back.
 *
 * A delete writes `deletedAt` instead of removing the row (see `BaseTask`), so
 * everything deleted from the app is still here. This script is the other half
 * of that — without it the stamp would only be a promise nobody could collect.
 *
 *   npx tsx scripts/deleted.ts                 # list what is in the bin
 *   npx tsx scripts/deleted.ts --user arqax0   # just one person's
 *   npx tsx scripts/deleted.ts --restore <id>  # put it back
 *
 * **Restore takes everything stamped at the same instant as the row you name.**
 * One delete writes one instant across both collections — a repeat and the
 * occurrences it made go together — so this puts back exactly what that delete
 * took, and nothing deleted on another occasion.
 */
import type { Db } from 'mongodb';

import { config } from '../src/config.js';
import { MongoStorage } from '../src/storage/mongo.storage.js';

interface Row {
  _id: string;
  name?: string;
  type?: string;
  userId?: string;
  deletedAt?: Date | null;
  subtasks?: unknown[];
}

const argOf = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);

  return at === -1 ? undefined : process.argv[at + 1];
};

const COLLECTIONS = ['tasks', 'repeatedTasks'];

/** Every stamped row in both collections, newest delete first. */
async function binned(db: Db, userId: string | undefined): Promise<[string, Row[]][]> {
  const owner = userId === undefined ? {} : { userId };
  const found = await Promise.all(COLLECTIONS.map(
    (name) => db.collection<Row>(name)
      .find({ deletedAt: { $ne: null, $exists: true }, ...owner })
      .sort({ deletedAt: -1 })
      .toArray(),
  ));

  return COLLECTIONS.map((name, index) => [name, found[index] ?? []]);
}

function describe(row: Row): string {
  const when = row.deletedAt?.toISOString() ?? '?';
  const steps = row.subtasks?.length ?? 0;
  const detail = steps === 0 ? '' : `, ${String(steps)} steps`;

  return `  ${when}  ${row._id}  [${String(row.type)}${detail}]  "${String(row.name)}"`;
}

/** Clears the stamp on every row sharing this instant, in both collections. */
async function restore(db: Db, at: Date): Promise<number> {
  const done = await Promise.all(COLLECTIONS.map(
    (name) => db.collection<Row>(name)
      .updateMany({ deletedAt: at }, { $set: { deletedAt: null } }),
  ));

  return done.reduce((sum, result) => sum + result.modifiedCount, 0);
}

/** The stamped row with this id, whichever collection holds it. */
async function findStamped(db: Db, id: string): Promise<Row | null> {
  const found = await Promise.all(COLLECTIONS.map(
    (name) => db.collection<Row>(name).findOne({ _id: id, deletedAt: { $ne: null } }),
  ));

  return found.find((row) => row !== null) ?? null;
}

const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);
const db = await storage.connect();

try {
  const id = argOf('--restore');

  if (id === undefined) {
    const groups = await binned(db, argOf('--user'));
    for (const [name, rows] of groups) {
      console.log(`\n${name}: ${String(rows.length)} deleted`);
      for (const row of rows) console.log(describe(row));
    }
    console.log('\nput one back with: npx tsx scripts/deleted.ts --restore <id>');
  } else {
    const row = await findStamped(db, id);

    if (row?.deletedAt == null) {
      console.log(`nothing deleted with id ${id}.`);
    } else {
      console.log(`restoring everything deleted at ${row.deletedAt.toISOString()}`);
      console.log(`  starting from "${String(row.name)}"`);
      console.log(`\nput back ${String(await restore(db, row.deletedAt))} rows.`);
    }
  }
} finally {
  await storage.close();
}
