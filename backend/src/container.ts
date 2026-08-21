import type { Db } from 'mongodb';

import { config } from './config.js';
import type { INotificationService } from './interfaces/notification-service.interface.js';
import { ConsoleNotificationService } from './services/console-notification.service.js';
import { FcmNotificationService } from './services/fcm-notification.service.js';
import { createMessaging } from './storage/fcm.storage.js';

import { DevicesRepository } from './repositories/devices.repository.js';
import { RepeatedTasksRepository } from './repositories/repeated-tasks.repository.js';
import { TasksRepository } from './repositories/tasks.repository.js';
import { UsersRepository } from './repositories/users.repository.js';
import { DevicesService } from './services/devices.service.js';
import { TaskGeneratorService } from './services/task-generator.service.js';
import { UsersService } from './services/users.service.js';

export interface Container {
  readonly usersRepository: UsersRepository;
  readonly usersService: UsersService;
  readonly tasksRepository: TasksRepository;
  readonly repeatedTasksRepository: RepeatedTasksRepository;
  readonly taskGenerator: TaskGeneratorService;
  readonly devicesRepository: DevicesRepository;
  readonly devicesService: DevicesService;
  readonly notifications: INotificationService;
  /** False when no Firebase key is configured and sends are only logged. */
  readonly pushConfigured: boolean;
}

/**
 * Builds the instances shared across the process, once the database connection
 * exists. A function rather than module-level constants because repositories
 * need a live `Db`, which is only available after `MongoStorage.connect()`.
 */
export function createContainer(db: Db): Container {
  const tasksRepository = new TasksRepository(db);
  const repeatedTasksRepository = new RepeatedTasksRepository(db);
  const usersRepository = new UsersRepository(db);
  const devicesRepository = new DevicesRepository(db);

  // Real pushes when a service-account key is configured, the console channel
  // when it is not, so a developer without Firebase credentials still sees
  // which events came due and every route keeps working.
  const messaging = createMessaging(config.firebaseServiceAccount);
  const notifications = messaging === null
    ? new ConsoleNotificationService()
    : new FcmNotificationService(devicesRepository, messaging, config.appUrl);

  return {
    usersRepository,
    usersService: new UsersService(usersRepository),
    tasksRepository,
    repeatedTasksRepository,
    taskGenerator: new TaskGeneratorService(tasksRepository, repeatedTasksRepository),
    devicesRepository,
    devicesService: new DevicesService(devicesRepository, notifications),
    notifications,
    pushConfigured: messaging !== null,
  };
}

/** Creates the indexes every collection needs. Run once at startup. */
export async function ensureIndexes(container: Container): Promise<void> {
  await Promise.all([
    container.tasksRepository.ensureIndexes(),
    container.repeatedTasksRepository.ensureIndexes(),
    container.usersRepository.ensureIndexes(),
    container.devicesRepository.ensureIndexes(),
  ]);
}
