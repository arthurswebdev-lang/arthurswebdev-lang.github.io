import { type RequestHandler, Router } from 'express';

import type { RepeatedTasksController } from '../controllers/repeated-tasks.controller.js';
import {
  validateCreate,
  validateDeleteById,
  validateGetById,
  validatePatch,
  validateUpdate,
} from '../middlewares/validation/repeated-tasks.validation.middleware.js';

/**
 * The configs are their own resource. They never appear under `/tasks`, because
 * they are not things a user completes — the event each one currently has
 * pending represents it there.
 */
export class RepeatedTasksRoutes {
  private readonly router = Router();

  constructor(
    private readonly repeatedTasksController: RepeatedTasksController,
    private readonly authenticate: RequestHandler,
  ) {}

  initRoutes(): Router {
    const controller = this.repeatedTasksController;
    const base = '/repeated-tasks';

    this.router.use(base, this.authenticate);

    this.router.get(base, controller.list.bind(controller));
    this.router.post(base, validateCreate, controller.create.bind(controller));
    this.router.get(`${base}/:id`, validateGetById, controller.getById.bind(controller));
    this.router.put(`${base}/:id`, validateUpdate, controller.updateById.bind(controller));
    // PATCH for "change this one thing", PUT for "here is the whole config".
    // Both reconcile events the same way; only the body differs.
    this.router.patch(`${base}/:id`, validatePatch, controller.patchById.bind(controller));
    this.router.delete(`${base}/:id`, validateDeleteById, controller.deleteById.bind(controller));

    return this.router;
  }
}
