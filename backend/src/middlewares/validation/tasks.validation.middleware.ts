import type { NextFunction, Request, Response } from 'express';

import {
  CreateTaskSchema,
  ListTasksQuerySchema,
  TaskIdInParams,
  UpdateTaskSchema,
  UpdateTaskStatusSchema,
} from '../../schemes/tasks.schemes.js';
import { validate, validateQuery } from './util/validation.util.js';

/**
 * `validateQuery`, not `validate`: Express 5 serves `req.query` from a getter
 * that re-parses the query string on every read, so a validated copy has to be
 * pinned back onto the request or the controller sees the raw values again.
 */
export function validateList(request: Request, _response: Response, next: NextFunction): void {
  try {
    validateQuery(request, ListTasksQuerySchema);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateCreate(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(CreateTaskSchema, request.body as object);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateGetById(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(TaskIdInParams, request.params);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateUpdate(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(TaskIdInParams, request.params);
    validate(UpdateTaskSchema, request.body as object);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateUpdateStatus(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  try {
    validate(TaskIdInParams, request.params);
    validate(UpdateTaskStatusSchema, request.body as object);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateDeleteById(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  try {
    validate(TaskIdInParams, request.params);
    next();
  } catch (error) {
    next(error);
  }
}
