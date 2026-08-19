import type { NextFunction, Request, Response } from 'express';

import type { IUsersService } from '../interfaces/users-service.interface.js';
import { currentUserId } from '../middlewares/auth.middleware.js';
import type { BodyRequest } from '../types/request.type.js';
import type { CreateUser, PublicUser } from '../types/user.types.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

export class UsersController {
  constructor(private readonly usersService: IUsersService) {}

  async signUp(
    request: BodyRequest<CreateUser>,
    response: Response<PublicUser>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { username, password } = request.body;
      const user: PublicUser = await this.usersService.signUp(username, password);
      SuccessHandlerUtil.handleAdd(response, next, user);
    } catch (error) {
      next(error);
    }
  }

  /** Confirms the credentials in the header belong to someone. */
  me(_request: Request, response: Response, next: NextFunction): void {
    try {
      response.json({
        id: currentUserId(response),
        username: response.locals['username'] as string,
      });
    } catch (error) {
      next(error);
    }
  }
}
