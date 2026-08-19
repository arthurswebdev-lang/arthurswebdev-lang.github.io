import type { NextFunction, Response } from 'express';

import type { TaskCategory } from '../enum/task-category.enum.js';
import type { TaskFilter } from '../enum/task-filter.enum.js';
import type { TaskStatus } from '../enum/task-status.enum.js';
import type { ITasksService } from '../interfaces/tasks-service.interface.js';
import type { BodyRequest, ParamsRequest, QueryRequest } from '../types/request.type.js';
import type {
  CreateTask, Task, TaskIdParams, UpdateTask,
} from '../types/tasks.types.js';
import { currentUserId } from '../middlewares/auth.middleware.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

/** Body accepted by `PATCH /tasks/:id/status`. */
interface UpdateTaskStatus {
  status: TaskStatus;
}

/** Query accepted by `GET /tasks`, after validation has narrowed it. */
interface ListTasksQuery {
  filter?: TaskFilter;
  category?: TaskCategory;
}

export class TasksController {
  constructor(private readonly tasksService: ITasksService) {}

  async list(
    request: QueryRequest<ListTasksQuery>,
    response: Response<Task[]>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const tasks: Task[] = await this.tasksService.listAll({
        userId: currentUserId(response),
        ...(request.query.filter === undefined ? {} : { filter: request.query.filter }),
        ...(request.query.category === undefined ? {} : { category: request.query.category }),
      });
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
      const task: Task | null = await this.tasksService.getById(request.params.id, currentUserId(response));
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
      const task: Task = await this.tasksService.create(request.body, currentUserId(response));
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
      const task: Task = await this.tasksService.updateById(
        request.params.id,
        currentUserId(response),
        request.body,
      );
      SuccessHandlerUtil.handleUpdate(response, next, task);
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(
    request: BodyRequest<UpdateTaskStatus, TaskIdParams>,
    response: Response<Task>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const task: Task = await this.tasksService.updateStatus(
        request.params.id,
        currentUserId(response),
        request.body.status,
      );
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
      await this.tasksService.deleteById(request.params.id, currentUserId(response));
      SuccessHandlerUtil.handleDelete(response, next);
    } catch (error) {
      next(error);
    }
  }
}
