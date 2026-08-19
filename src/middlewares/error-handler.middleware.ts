import type { ErrorRequestHandler } from 'express';
import http from 'node:http';

import { HttpException } from '../utils/http-errors/http.exception.js';
import { InputValidationError } from '../utils/http-errors/input-validation.error.js';
import { HttpStatusCodes } from '../utils/http-status-codes.util.js';

interface ErrorBody {
  status: HttpStatusCodes;
  message: string;
  code: string | undefined;
  errors?: string[];
}

function getErrorBody(error: unknown): ErrorBody {
  if (error instanceof InputValidationError) {
    const { status, message, errors } = error;

    return {
      status, message, code: http.STATUS_CODES[status], errors: [...errors],
    };
  }

  if (error instanceof HttpException) {
    const { status, message } = error;

    return { status, message, code: http.STATUS_CODES[status] };
  }

  // express.json() rejects a malformed body with a SyntaxError; that is the
  // client's mistake, not ours.
  if (error instanceof SyntaxError) {
    const status = HttpStatusCodes.BAD_REQUEST;

    return { status, message: error.message, code: http.STATUS_CODES[status] };
  }

  const status = HttpStatusCodes.INTERNAL_SERVER_ERROR;
  const message = 'The server encountered an internal error. Try again later.';

  return { status, message, code: http.STATUS_CODES[status] };
}

/** Last middleware in the stack: turns thrown errors into JSON responses. */
export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const body = getErrorBody(error);

  // Anything that maps to a 5xx is ours to investigate, so keep the original.
  if (body.status >= HttpStatusCodes.INTERNAL_SERVER_ERROR) console.error(error);

  response.status(body.status).json(body);
};
