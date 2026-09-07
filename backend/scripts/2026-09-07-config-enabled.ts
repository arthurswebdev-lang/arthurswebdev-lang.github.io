/**
 * Gives every stored config the `enabled` flag it now carries.
 *
 * Every existing config is running — there was no way to pause one until now —
 * so the honest translation of all of them is `true`. Nothing changes about any
 * schedule; the field simply starts saying out loud what every config already
 * did, and pausing is the new part.
 *
 * Run this **before** deploying the code that reads the field. A config without
 * it reaches `syncPendingEvents` as `undefined`, which is falsy, so every
 * repeat in the database would read as paused and the poller would quietly stop
 * generating anything at all. That is the failure this ordering exists to
 * avoid, and it is silent, which makes it worse than a crash.
 *
 * Idempotent. A config that already carries `enabled` is left alone.
 *
 *   npx tsx scripts/2026-09-07-config-enabled.ts          # report only
 *   npx tsx scripts/2026-09-07-config-enabled.ts --write  # apply
 */
import { config } from '../src/config.js';
import { MongoStorage } from '../src/storage/mongo.storage.js';

const write = process.argv.includes('--write');
const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);

const db = await storage.connect();

try {
  const collection = db.collection('repeatedTasks');
  const missing = { enabled: { $exists: false } };
  const pending = await collection.find(missing).toArray();

  console.log(`database: ${config.mongoDbName}`);
  console.log(`\nconfigs without enabled: ${String(pending.length)}`);
  for (const doc of pending) {
    console.log(`  [${String(doc['type'])}] "${String(doc['name'])}"  ->  running`);
  }

  if (!write) {
    console.log('\ndry run. re-run with --write to apply.');
  } else {
    const result = await collection.updateMany(missing, { $set: { enabled: true } });
    console.log(`\napplied to ${String(result.modifiedCount)} configs.`);
  }
} finally {
  await storage.close();
}
