import type { NextFunction, Request, Response } from 'express';

import { TaskIdInParams } from '../../schemes/common.schemes.js';
import {
  CreateRepeatedTaskSchema, UpdateRepeatedTaskSchema,
} from '../../schemes/repeated-tasks.schemes.js';
import { validate } from './util/validation.util.js';

export function validateCreate(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(CreateRepeatedTaskSchema, request.body as object);
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
    validate(UpdateRepeatedTaskSchema, request.body as object);
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
