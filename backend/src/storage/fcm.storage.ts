import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

/**
 * Owns the Firebase Admin connection, the way `MongoStorage` owns Mongo's, and
 * hands a `Messaging` to whoever sends pushes.
 *
 * Firebase is used here as delivery and nothing else: no Firestore, no Cloud
 * Functions, no Cloud Scheduler. Deciding *what* is due stays in
 * `EventPollingService`, against our own Mongo, so the schedule is not tied to
 * a Google Cloud billing account.
 */

/**
 * fly.io secrets are a single line, and a service-account key is multi-line
 * JSON, so accept both: raw JSON when it is convenient, base64 when it is not.
 */
function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trimStart().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');

  return JSON.parse(text) as ServiceAccount;
}

/**
 * The FCM sender, or `null` when no key is configured.
 *
 * Null is a supported state, not a failure: local development and the test
 * suite have no service account, and a missing key must leave the API fully
 * working rather than refusing to boot. The caller falls back to the console
 * channel. A key that is present but *broken*, on the other hand, throws —
 * that is a misconfiguration worth failing loudly on.
 */
export function createMessaging(serviceAccount: string | undefined): Messaging | null {
  if (serviceAccount === undefined || serviceAccount.trim() === '') return null;

  // initializeApp is process-global and throws on a second call with the same
  // name, which a watch-mode reload would otherwise trigger.
  const existing = getApps()[0];
  const app = existing ?? initializeApp({ credential: cert(parseServiceAccount(serviceAccount)) });

  return getMessaging(app);
}
