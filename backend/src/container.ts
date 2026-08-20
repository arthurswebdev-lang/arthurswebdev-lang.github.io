import type { Db } from 'mongodb';

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

  return {
    usersRepository,
    usersService: new UsersService(usersRepository),
    tasksRepository,
    repeatedTasksRepository,
    taskGenerator: new TaskGeneratorService(tasksRepository, repeatedTasksRepository),
    devicesRepository,
    devicesService: new DevicesService(devicesRepository),
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
