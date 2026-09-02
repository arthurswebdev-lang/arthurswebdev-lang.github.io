import type { NextFunction, Request, Response } from 'express';

import type { IRepeatedTasksService } from '../interfaces/repeated-tasks-service.interface.js';
import type { BodyRequest, ParamsRequest } from '../types/request.type.js';
import type { TaskIdParams } from '../types/tasks.types.js';
import type {
  CreateRepeatedTask, PatchRepeatedTask, RepeatedTask, UpdateRepeatedTask,
} from '../types/repeated-tasks.types.js';
import { currentUserId } from '../middlewares/auth.middleware.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

export class RepeatedTasksController {
  constructor(private readonly repeatedTasksService: IRepeatedTasksService) {}

  async list(
    _request: Request,
    response: Response<RepeatedTask[]>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const configs: RepeatedTask[] = await this.repeatedTasksService.listAll(
        currentUserId(response),
      );
      SuccessHandlerUtil.handleList(response, next, configs);
    } catch (error) {
      next(error);
    }
  }

  async getById(
    request: ParamsRequest<TaskIdParams>,
    response: Response<RepeatedTask>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const config = await this.repeatedTasksService.getById(request.params.id, currentUserId(response));
      SuccessHandlerUtil.handleGet(response, next, config);
    } catch (error) {
      next(error);
    }
  }

  async create(
    request: BodyRequest<CreateRepeatedTask>,
    response: Response<RepeatedTask>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const config: RepeatedTask = await this.repeatedTasksService.create(
        request.body,
        currentUserId(response),
      );
      SuccessHandlerUtil.handleAdd(response, next, config);
    } catch (error) {
      next(error);
    }
  }

  async updateById(
    request: BodyRequest<UpdateRepeatedTask, TaskIdParams>,
    response: Response<RepeatedTask>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const config: RepeatedTask = await this.repeatedTasksService.updateById(
        request.params.id,
        currentUserId(response),
        request.body,
      );
      SuccessHandlerUtil.handleUpdate(response, next, config);
    } catch (error) {
      next(error);
    }
  }

  async patchById(
    request: BodyRequest<PatchRepeatedTask, TaskIdParams>,
    response: Response<RepeatedTask>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const config: RepeatedTask = await this.repeatedTasksService.patchById(
        request.params.id,
        currentUserId(response),
        request.body,
      );
      SuccessHandlerUtil.handleUpdate(response, next, config);
    } catch (error) {
      next(error);
    }
  }

  async deleteById(
    request: ParamsRequest<TaskIdParams>,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await this.repeatedTasksService.deleteById(request.params.id, currentUserId(response));
      SuccessHandlerUtil.handleDelete(response, next);
    } catch (error) {
      next(error);
    }
  }
}
