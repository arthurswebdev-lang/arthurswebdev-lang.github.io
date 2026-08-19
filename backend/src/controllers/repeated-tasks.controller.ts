import type { NextFunction, Request, Response } from 'express';

import type { IRepeatedTasksService } from '../interfaces/repeated-tasks-service.interface.js';
import type { BodyRequest, ParamsRequest } from '../types/request.type.js';
import type { TaskIdParams } from '../types/tasks.types.js';
import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../types/repeated-tasks.types.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

export class RepeatedTasksController {
  constructor(private readonly repeatedTasksService: IRepeatedTasksService) {}

  async list(
    _request: Request,
    response: Response<RepeatedTask[]>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const configs: RepeatedTask[] = await this.repeatedTasksService.listAll();
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
      const config = await this.repeatedTasksService.getById(request.params.id);
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
      const config: RepeatedTask = await this.repeatedTasksService.create(request.body);
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
      await this.repeatedTasksService.deleteById(request.params.id);
      SuccessHandlerUtil.handleDelete(response, next);
    } catch (error) {
      next(error);
    }
  }
}
