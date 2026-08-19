import { type RequestHandler, Router } from 'express';

import type { TasksController } from '../controllers/tasks.controller.js';
import {
  validateClear,
  validateCreate,
  validateDeleteById,
  validateGetById,
  validateList,
  validateUpdate,
  validateUpdateStatus,
  validateUpdateSubtaskStatus,
} from '../middlewares/validation/tasks.validation.middleware.js';

export class TasksRoutes {
  private readonly router = Router();

  constructor(
    private readonly tasksController: TasksController,
    private readonly authenticate: RequestHandler,
  ) {}

  initRoutes(): Router {
    const controller = this.tasksController;

    // Everything below needs credentials; nothing here is public.
    this.router.use('/tasks', this.authenticate);

    this.router.get('/tasks', validateList, controller.list.bind(controller));
    this.router.post('/tasks', validateCreate, controller.create.bind(controller));
    // Ahead of /tasks/:id: otherwise "clear" is read as an id and fails as a
    // malformed uuid.
    this.router.post('/tasks/clear', validateClear, controller.clear.bind(controller));
    this.router.get('/tasks/:id', validateGetById, controller.getById.bind(controller));
    // PUT replaces the task: the body is the full representation, same rules as
    // create. Omitted fields are not kept — they fall back to their defaults.
    this.router.put('/tasks/:id', validateUpdate, controller.updateById.bind(controller));
    // The only way to move a generated event; PUT refuses those outright.
    this.router.patch(
      '/tasks/:id/status',
      validateUpdateStatus,
      controller.updateStatus.bind(controller),
    );
    this.router.patch(
      '/tasks/:id/subtasks/:subtaskId/status',
      validateUpdateSubtaskStatus,
      controller.updateSubtaskStatus.bind(controller),
    );
    this.router.delete('/tasks/:id', validateDeleteById, controller.deleteById.bind(controller));

    return this.router;
  }
}
