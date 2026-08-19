import express, { type Express, type RequestHandler } from 'express';

import type { Container } from './container.js';
import { HealthController } from './controllers/health.controller.js';
import { RepeatedTasksController } from './controllers/repeated-tasks.controller.js';
import { UsersController } from './controllers/users.controller.js';
import { TasksController } from './controllers/tasks.controller.js';
import { authenticate } from './middlewares/auth.middleware.js';
import { errorHandler } from './middlewares/error-handler.middleware.js';
import { HealthRoutes } from './routes/health.routes.js';
import { RepeatedTasksRoutes } from './routes/repeated-tasks.routes.js';
import { UsersRoutes } from './routes/users.routes.js';
import { TasksRoutes } from './routes/tasks.routes.js';
import { HealthService } from './services/health.service.js';
import { RepeatedTasksService } from './services/repeated-tasks.service.js';
import { TasksService } from './services/tasks.service.js';

/** Wires the two task resources; kept out of createApp to keep it readable. */
function mountTaskRoutes(app: Express, container: Container, requireUser: RequestHandler): void {
  const { tasksRepository, repeatedTasksRepository, taskGenerator } = container;

  const tasksService = new TasksService(tasksRepository, taskGenerator);
  app.use(new TasksRoutes(new TasksController(tasksService), requireUser).initRoutes());

  const repeatedTasksService = new RepeatedTasksService(
    repeatedTasksRepository,
    tasksRepository,
    taskGenerator,
  );
  app.use(new RepeatedTasksRoutes(
    new RepeatedTasksController(repeatedTasksService),
    requireUser,
  ).initRoutes());
}

export function createApp(container: Container): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  const healthRoutes = new HealthRoutes(new HealthController(new HealthService()));
  app.use(healthRoutes.initRoutes());

  const requireUser = authenticate(container.usersService);

  app.use(new UsersRoutes(new UsersController(container.usersService), requireUser).initRoutes());
  mountTaskRoutes(app, container, requireUser);

  // Registered last: Express only reaches it once every route has passed.
  app.use(errorHandler);

  return app;
}
