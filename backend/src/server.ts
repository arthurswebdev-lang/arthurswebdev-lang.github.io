import { createApp } from './app.js';
import { config } from './config.js';
import { createContainer, ensureIndexes } from './container.js';
import type { INotificationService } from './interfaces/notification-service.interface.js';
import { ConsoleNotificationService } from './services/console-notification.service.js';
import { EventPollingService } from './services/event-polling.service.js';
import { FcmNotificationService } from './services/fcm-notification.service.js';
import { createMessaging } from './storage/fcm.storage.js';
import { describeMongoTarget, MongoStorage } from './storage/mongo.storage.js';

const storage = new MongoStorage(config.mongoUrl, config.mongoDbName);
const db = await storage.connect();
const container = createContainer(db);
await ensureIndexes(container);

const app = createApp(container);
const server = app.listen(config.port);

// Real pushes when a service-account key is configured, the console channel
// when it is not — so a developer without Firebase credentials still sees which
// events came due, and deploying push is a matter of setting one secret.
const messaging = createMessaging(config.firebaseServiceAccount);
const notifications: INotificationService = messaging === null
  ? new ConsoleNotificationService()
  : new FcmNotificationService(container.devicesRepository, messaging, config.appUrl);

const eventPolling = new EventPollingService(
  container.tasksRepository,
  notifications,
  container.taskGenerator,
  config.pollIntervalMs,
);

// Express invokes the listen callback even when the bind fails, so success is
// only trustworthy from the 'listening' event plus a non-null address().
server.on('listening', () => {
  const address = server.address();
  if (address === null) return;

  const shown = typeof address === 'string' ? address : `http://localhost:${String(address.port)}`;
  console.log(`listening on ${shown} (${config.nodeEnv})`);
  console.log(`mongo ${describeMongoTarget(config.mongoUrl, config.mongoDbName)}`);

  eventPolling.start();
  console.log(`event polling every ${String(config.pollIntervalMs)}ms`);
  console.log(messaging === null
    ? 'push: not configured (set FIREBASE_SERVICE_ACCOUNT) — logging due events instead'
    : 'push: firebase cloud messaging');
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${String(config.port)} is already in use. Set PORT to a free port.`);
  } else {
    console.error('Server failed to start:', error);
  }

  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Clear the timer first, or its next tick keeps the process alive after
    // the server has closed.
    eventPolling.stop();

    server.close(() => {
      void storage.close().then(() => {
        process.exit(0);
      });
    });
  });
}
