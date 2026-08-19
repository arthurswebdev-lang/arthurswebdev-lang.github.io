import express, { type Express } from 'express';

import type { Container } from './container.js';
import { HealthController } from './controllers/health.controller.js';
import { RepeatedTasksController } from './controllers/repeated-tasks.controller.js';
import { TasksController } from './controllers/tasks.controller.js';
import { errorHandler } from './middlewares/error-handler.middleware.js';
import { HealthRoutes } from './routes/health.routes.js';
import { RepeatedTasksRoutes } from './routes/repeated-tasks.routes.js';
import { TasksRoutes } from './routes/tasks.routes.js';
import { HealthService } from './services/health.service.js';
import { RepeatedTasksService } from './services/repeated-tasks.service.js';
import { TasksService } from './services/tasks.service.js';

export function createApp(container: Container): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  const healthRoutes = new HealthRoutes(new HealthController(new HealthService()));
  app.use(healthRoutes.initRoutes());

  const { tasksRepository, repeatedTasksRepository, taskGenerator } = container;

  const tasksService = new TasksService(tasksRepository, taskGenerator);
  const tasksRoutes = new TasksRoutes(new TasksController(tasksService));
  app.use(tasksRoutes.initRoutes());

  const repeatedTasksService = new RepeatedTasksService(
    repeatedTasksRepository,
    tasksRepository,
    taskGenerator,
  );
  const repeatedTasksRoutes = new RepeatedTasksRoutes(
    new RepeatedTasksController(repeatedTasksService),
  );
  app.use(repeatedTasksRoutes.initRoutes());

  // Registered last: Express only reaches it once every route has passed.
  app.use(errorHandler);

  return app;
}
