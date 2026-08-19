import type { NextFunction, Response } from 'express';

import type { TaskFilter } from '../enum/task-filter.enum.js';
import type { ITasksService } from '../interfaces/tasks-service.interface.js';
import type { BodyRequest, ParamsRequest, QueryRequest } from '../types/request.type.js';
import type {
  CreateTask, Task, TaskIdParams, UpdateTask,
} from '../types/tasks.types.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

/** Query accepted by `GET /tasks`, after validation has narrowed it. */
interface ListTasksQuery {
  filter?: TaskFilter;
}

export class TasksController {
  constructor(private readonly tasksService: ITasksService) {}

  async list(
    request: QueryRequest<ListTasksQuery>,
    response: Response<Task[]>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const tasks: Task[] = await this.tasksService.listAll(request.query.filter);
      SuccessHandlerUtil.handleList(response, next, tasks);
    } catch (error) {
      next(error);
    }
  }

  async getById(
    request: ParamsRequest<TaskIdParams>,
    response: Response<Task>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const task: Task | null = await this.tasksService.getById(request.params.id);
      SuccessHandlerUtil.handleGet(response, next, task);
    } catch (error) {
      next(error);
    }
  }

  async create(
    request: BodyRequest<CreateTask>,
    response: Response<Task>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const task: Task = await this.tasksService.create(request.body);
      SuccessHandlerUtil.handleAdd(response, next, task);
    } catch (error) {
      next(error);
    }
  }

  async updateById(
    request: BodyRequest<UpdateTask, TaskIdParams>,
    response: Response<Task>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const task: Task = await this.tasksService.updateById(request.params.id, request.body);
      SuccessHandlerUtil.handleUpdate(response, next, task);
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
      await this.tasksService.deleteById(request.params.id);
      SuccessHandlerUtil.handleDelete(response, next);
    } catch (error) {
      next(error);
    }
  }
}
