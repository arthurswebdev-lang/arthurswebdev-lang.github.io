import { Router } from 'express';

import type { HealthController } from '../controllers/health.controller.js';

export class HealthRoutes {
  private readonly router = Router();

  constructor(private readonly healthController: HealthController) {}

  initRoutes(): Router {
    this.router.get('/health', this.healthController.health.bind(this.healthController));

    return this.router;
  }
}
