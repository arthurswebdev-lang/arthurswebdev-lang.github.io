import type { NextFunction, Request, Response } from 'express';

import type { IHealthService } from '../interfaces/health-service.interface.js';
import type { HealthStatus } from '../types/health.types.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

export class HealthController {
  constructor(private readonly healthService: IHealthService) {}

  async health(
    _request: Request,
    response: Response<HealthStatus>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const healthStatus: HealthStatus = await this.healthService.health();
      SuccessHandlerUtil.handleGet(response, next, healthStatus);
    } catch (error) {
      next(error);
    }
  }
}
