import {
  type NextFunction, type Request, type RequestHandler, type Response, Router,
} from 'express';

import type { DevicesController } from '../controllers/devices.controller.js';
import { validate } from '../middlewares/validation/util/validation.util.js';
import { RegisterDeviceSchema } from '../schemes/devices.schemes.js';

function validateRegister(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(RegisterDeviceSchema, request.body as object);
    next();
  } catch (error) {
    next(error);
  }
}

export class DevicesRoutes {
  private readonly router = Router();

  constructor(
    private readonly devicesController: DevicesController,
    private readonly authenticate: RequestHandler,
  ) {}

  initRoutes(): Router {
    const controller = this.devicesController;

    // Behind auth: a token registered without credentials would belong to
    // nobody, and there would be no way to know whose events it should get.
    this.router.post(
      '/devices',
      this.authenticate,
      validateRegister,
      controller.register.bind(controller),
    );

    // No body, so nothing to validate — the caller is the whole input.
    this.router.post('/devices/test', this.authenticate, controller.test.bind(controller));

    return this.router;
  }
}
