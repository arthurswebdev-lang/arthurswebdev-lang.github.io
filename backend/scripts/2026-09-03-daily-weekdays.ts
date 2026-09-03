/**
 * Gives every stored daily config the `weekdays` field it now carries.
 *
 * A daily config used to fire on all seven days with no way to say otherwise,
 * so the honest translation of every existing one is all seven days: nothing
 * about any schedule changes, and the field simply starts saying out loud what
 * the config already did. Deselecting days is the new part.
 *
 * Run this **before** deploying the code that reads the field. A config without
 * it reaches `runsOnWeekday` as `undefined` and the poller's pass fails — the
 * pass is caught and retried, so it is recoverable, but there is no reason to
 * live through it.
 *
 * Idempotent. Configs that already carry `weekdays` are left alone, which also
 * means it will not touch the weekly ones.
 *
 *   npx tsx scripts/2026-09-03-daily-weekdays.ts          # report only
 *   npx tsx scripts/2026-09-03-daily-weekdays.ts --write  # apply
 */
import { config } from '../src/config.js';
import { ALL_WEEKDAYS } from '../src/schemes/common.schemes.js';
import { MongoStorage } from '../src/storage/mongo.storage.js';

/**
 * `TaskType.REPEATED_DAILY` is the string 'DAILY', not 'REPEATED_DAILY' — the
 * one inconsistency in that enum, and it is what is actually in the documents.
 */
const DAILY = 'DAILY';

const write = process.argv.includes('--write');
const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);

const db = await storage.connect();

try {
  const collection = db.collection('repeatedTasks');
  const missing = { type: DAILY, weekdays: { $exists: false } };
  const pending = await collection.find(missing).toArray();

  console.log(`database: ${config.mongoDbName}`);
  console.log(`\ndaily configs without weekdays: ${String(pending.length)}`);
  for (const doc of pending) {
    console.log(`  "${String(doc['name'])}"  ->  every day`);
  }

  if (!write) {
    console.log('\ndry run. re-run with --write to apply.');
  } else {
    const result = await collection.updateMany(missing, { $set: { weekdays: ALL_WEEKDAYS } });
    console.log(`\napplied to ${String(result.modifiedCount)} configs.`);
  }
} finally {
  await storage.close();
}
