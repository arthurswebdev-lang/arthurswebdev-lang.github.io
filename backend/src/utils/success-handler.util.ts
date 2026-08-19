import type { NextFunction, Response } from 'express';

import { ResourceNotFoundError } from './http-errors/resource-not-found.error.js';
import { HttpStatusCodes } from './http-status-codes.util.js';

/**
 * Uniform success responses, so controllers pick an intent (`handleGet`,
 * `handleAdd`, ...) instead of repeating status-code decisions.
 *
 * Exported as functions rather than static methods because a static-only class
 * is rejected by the `no-extraneous-class` rule; import the module as a
 * namespace to keep `SuccessHandlerUtil.handleGet(...)` call sites:
 * `import * as SuccessHandlerUtil from '../utils/success-handler.util.js';`
 */
function sendResponse<T>(response: Response<T>, status: HttpStatusCodes, data: T): void {
  response.status(status).json(data);
}

/** Handles `list` type requests. */
export function handleList<T>(response: Response<T>, _next: NextFunction, result: T): void {
  sendResponse(response, HttpStatusCodes.OK, result);
}

/** Handles `get` type requests, 404-ing when nothing was found. */
export function handleGet<T>(
  response: Response<T>,
  next: NextFunction,
  result: T | null | undefined,
): void {
  if (result == null) {
    next(new ResourceNotFoundError('The specified resource is not found.'));
    return;
  }

  sendResponse(response, HttpStatusCodes.OK, result);
}

/** Handles `add` type requests. */
export function handleAdd<T>(
  response: Response<T>,
  _next: NextFunction,
  result: T | null | undefined,
): void {
  if (result == null) {
    response.sendStatus(HttpStatusCodes.NO_CONTENT);
    return;
  }

  sendResponse(response, HttpStatusCodes.CREATED, result);
}

/** Handles `update` type requests. */
export function handleUpdate<T>(
  response: Response<T>,
  _next: NextFunction,
  result: T | null | undefined,
): void {
  if (result == null) {
    response.sendStatus(HttpStatusCodes.NO_CONTENT);
    return;
  }

  sendResponse(response, HttpStatusCodes.OK, result);
}

/** Handles `delete` type requests: nothing survives to return, so 204. */
export function handleDelete(response: Response, _next: NextFunction): void {
  response.sendStatus(HttpStatusCodes.NO_CONTENT);
}
