import express, { type Express, type RequestHandler } from 'express';

import { config } from './config.js';

import type { Container } from './container.js';
import { AssistantController } from './controllers/assistant.controller.js';
import { DevicesController } from './controllers/devices.controller.js';
import { HealthController } from './controllers/health.controller.js';
import { RepeatedTasksController } from './controllers/repeated-tasks.controller.js';
import { UsersController } from './controllers/users.controller.js';
import { TasksController } from './controllers/tasks.controller.js';
import { authenticate } from './middlewares/auth.middleware.js';
import { cors } from './middlewares/cors.middleware.js';
import { errorHandler } from './middlewares/error-handler.middleware.js';
import { AssistantRoutes } from './routes/assistant.routes.js';
import { DevicesRoutes } from './routes/devices.routes.js';
import { HealthRoutes } from './routes/health.routes.js';
import { RepeatedTasksRoutes } from './routes/repeated-tasks.routes.js';
import { UsersRoutes } from './routes/users.routes.js';
import { TasksRoutes } from './routes/tasks.routes.js';
import { AssistantToolsService } from './services/assistant-tools.service.js';
import { AssistantService } from './services/assistant.service.js';
import { HealthService } from './services/health.service.js';
import { RepeatedTasksService } from './services/repeated-tasks.service.js';
import { TasksService } from './services/tasks.service.js';

/** Null when no Claude key is set: the routes then answer 503. */
function assistantController(
  container: Container,
  tools: AssistantToolsService,
): AssistantController | null {
  const client = container.assistantClient;
  if (client === null) return null;

  const service = new AssistantService(
    container.assistantSessionsRepository,
    container.assistantUsageRepository,
    client,
    tools,
  );

  return new AssistantController(service);
}

/**
 * Wires the two task resources, and the assistant that creates through the
 * same two services — so it can store nothing the API itself would refuse.
 */
function mountTaskRoutes(app: Express, container: Container, requireUser: RequestHandler): void {
  const { tasksRepository, repeatedTasksRepository, taskGenerator } = container;

  const tasksService = new TasksService(tasksRepository, repeatedTasksRepository, taskGenerator);
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

  const tools = new AssistantToolsService(tasksService, repeatedTasksService);
  app.use(new AssistantRoutes(assistantController(container, tools), requireUser).initRoutes());
}

export function createApp(container: Container): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors(config.allowedOrigins));
  app.use(express.json());

  const healthRoutes = new HealthRoutes(new HealthController(new HealthService()));
  app.use(healthRoutes.initRoutes());

  const requireUser = authenticate(container.usersService);

  app.use(new UsersRoutes(new UsersController(container.usersService), requireUser).initRoutes());
  app.use(new DevicesRoutes(
    new DevicesController(container.devicesService),
    requireUser,
  ).initRoutes());
  mountTaskRoutes(app, container, requireUser);

  // Registered last: Express only reaches it once every route has passed.
  app.use(errorHandler);

  return app;
}
