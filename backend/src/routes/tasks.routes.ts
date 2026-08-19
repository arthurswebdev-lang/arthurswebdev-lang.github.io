import { Router } from 'express';

import type { TasksController } from '../controllers/tasks.controller.js';
import {
  validateCreate,
  validateDeleteById,
  validateGetById,
  validateList,
  validateUpdate,
  validateUpdateStatus,
} from '../middlewares/validation/tasks.validation.middleware.js';

export class TasksRoutes {
  private readonly router = Router();

  constructor(private readonly tasksController: TasksController) {}

  initRoutes(): Router {
    const controller = this.tasksController;

    this.router.get('/tasks', validateList, controller.list.bind(controller));
    this.router.post('/tasks', validateCreate, controller.create.bind(controller));
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
    this.router.delete('/tasks/:id', validateDeleteById, controller.deleteById.bind(controller));

    return this.router;
  }
}
