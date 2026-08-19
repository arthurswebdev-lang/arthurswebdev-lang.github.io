import {
  type NextFunction, type Request, type RequestHandler, type Response, Router,
} from 'express';

import type { UsersController } from '../controllers/users.controller.js';
import { SignUpSchema } from '../schemes/users.schemes.js';
import { validate } from '../middlewares/validation/util/validation.util.js';

function validateSignUp(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(SignUpSchema, request.body as object);
    next();
  } catch (error) {
    next(error);
  }
}

export class UsersRoutes {
  private readonly router = Router();

  constructor(
    private readonly usersController: UsersController,
    private readonly authenticate: RequestHandler,
  ) {}

  initRoutes(): Router {
    const controller = this.usersController;

    // The only route that does not need credentials — it creates them.
    this.router.post('/users', validateSignUp, controller.signUp.bind(controller));
    this.router.get('/me', this.authenticate, controller.me.bind(controller));

    return this.router;
  }
}
