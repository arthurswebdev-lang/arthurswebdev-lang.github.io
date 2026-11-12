import type { NextFunction, Request, Response } from 'express';

import {
  AcceptPlanSchema, SendMessageSchema, SessionIdInParams, StartSessionSchema,
} from '../../schemes/assistant.schemes.js';
import { validate } from './util/validation.util.js';

export function validateStart(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(StartSessionSchema, request.body as object);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateSend(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(SessionIdInParams, request.params);
    validate(SendMessageSchema, request.body as object);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateAccept(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(SessionIdInParams, request.params);
    validate(AcceptPlanSchema, request.body as object);
    next();
  } catch (error) {
    next(error);
  }
}

export function validateClose(request: Request, _response: Response, next: NextFunction): void {
  try {
    validate(SessionIdInParams, request.params);
    next();
  } catch (error) {
    next(error);
  }
}
