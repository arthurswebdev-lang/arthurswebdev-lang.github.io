import type { NextFunction, Response } from 'express';

import type { TaskCategory } from '../enum/task-category.enum.js';
import type { TaskFilter } from '../enum/task-filter.enum.js';
import type { TaskStatus } from '../enum/task-status.enum.js';
import type { ITasksService } from '../interfaces/tasks-service.interface.js';
import type {
  BodyRequest, ParamsQueryRequest, ParamsRequest, QueryRequest,
} from '../types/request.type.js';
import type {
  CreateTask, Task, TaskIdParams, UpdateTask,
} from '../types/tasks.types.js';
import { currentUserId } from '../middlewares/auth.middleware.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

/** Body accepted by `POST /tasks/clear`. */
interface ClearTasks {
  ids: string[];
  /** Validated with a default, so it is always present by the time it is read. */
  permanent: boolean;
}

/**
 * Query accepted by `DELETE /tasks/:id`.
 *
 * Optional like `ListTasksQuery`, and for the same reason: Express types a raw
 * query as `ParsedQs`, where nothing is guaranteed, so a required field here
 * makes the handler unassignable at registration. Validation defaults it, so by
 * the time it is read it is a real boolean.
 */
interface DeleteTaskQuery {
  permanent?: boolean;
}

/** Route params for the subtask endpoint. */
type SubtaskIdParams = Record<'id' | 'subtaskId', string>;

/** Body accepted by `PATCH /tasks/:id/subtasks/:subtaskId/status`. */
interface UpdateSubtaskStatus {
  status: TaskStatus.DONE | TaskStatus.TODO;
}

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

  async updateSubtaskStatus(
    request: BodyRequest<UpdateSubtaskStatus, SubtaskIdParams>,
    response: Response<Task>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const task: Task = await this.tasksService.updateSubtaskStatus(
        request.params.id,
        currentUserId(response),
        request.params.subtaskId,
        request.body.status,
      );
      SuccessHandlerUtil.handleUpdate(response, next, task);
    } catch (error) {
      next(error);
    }
  }

  async clear(
    request: BodyRequest<ClearTasks>,
    response: Response<{ deleted: number }>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const deleted = await this.tasksService.clear(
        request.body.ids,
        currentUserId(response),
        request.body.permanent,
      );
      response.json({ deleted });
    } catch (error) {
      next(error);
    }
  }

  async deleteById(
    request: ParamsQueryRequest<TaskIdParams, DeleteTaskQuery>,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await this.tasksService.deleteById(
        request.params.id,
        currentUserId(response),
        request.query.permanent,
      );
      SuccessHandlerUtil.handleDelete(response, next);
    } catch (error) {
      next(error);
    }
  }
}
