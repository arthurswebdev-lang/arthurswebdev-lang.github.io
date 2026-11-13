/**
 * Gives every stored task and config the `deletedAt` stamp they now carry.
 *
 * Everything in the database right now exists, so the honest translation of
 * all of it is `null`. Nothing changes about any task; the field simply starts
 * saying out loud what every row already meant.
 *
 * Unlike the `enabled` migration, **this one is not a prerequisite for the
 * deploy.** Every read asks for `deletedAt: null`, and Mongo matches a missing
 * key against null, so a row written before the field existed already reads as
 * alive. Running this is tidying: it makes the stored shape match the type, and
 * it lets the `deletedAt` index be useful rather than sparse. Run it whenever.
 *
 * Idempotent. A row that already carries the field is left alone.
 *
 *   npx tsx scripts/2026-11-13-deleted-at.ts          # report only
 *   npx tsx scripts/2026-11-13-deleted-at.ts --write  # apply
 */
import { config } from '../src/config.js';
import { MongoStorage } from '../src/storage/mongo.storage.js';

const write = process.argv.includes('--write');
const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);

const db = await storage.connect();
const missing = { deletedAt: { $exists: false } };

const NAMES = ['tasks', 'repeatedTasks'];

try {
  console.log(`database: ${config.mongoDbName}`);

  // Counted for every collection at once rather than one per turn of a loop:
  // the two are independent, and `no-await-in-loop` is right that a loop of
  // awaits here would be slower for no reason.
  const counts = await Promise.all(NAMES.map(async (name) => ({
    name,
    pending: await db.collection(name).countDocuments(missing),
    total: await db.collection(name).countDocuments({}),
  })));

  for (const { name, pending, total } of counts) {
    console.log(`\n${name}: ${String(pending)} of ${String(total)} without deletedAt`);
  }

  if (write) {
    const applied = await Promise.all(NAMES.map(
      (name) => db.collection(name).updateMany(missing, { $set: { deletedAt: null } }),
    ));
    for (const [index, result] of applied.entries()) {
      console.log(`\n${String(NAMES[index])}: stamped ${String(result.modifiedCount)} as alive.`);
    }
  } else {
    console.log('\ndry run. re-run with --write to apply.');
  }
} finally {
  await storage.close();
}
