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

/**
 * Last middleware in the stack: turns thrown errors into JSON responses, and
 * records every one of them.
 *
 * A 4xx is logged as loudly as a 5xx here, which would be wrong for a public
 * API and is right for this one. Nothing but our own frontend calls it, so a
 * rejected request is not a stranger sending nonsense — it is this project
 * sending something it should not, which is a bug of ours wearing a client's
 * status code. Leaving it unlogged made exactly that invisible from both ends:
 * the phone showed nothing and the log had nothing to show.
 */
export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const body = getErrorBody(error);
  const where = `[${String(body.status)}] ${request.method} ${request.originalUrl}`;

  if (body.status >= HttpStatusCodes.INTERNAL_SERVER_ERROR) {
    // Ours outright: keep the original, stack and all.
    console.error(where, error);
  } else {
    // The message already names the offending fields — it is what the client
    // is told, and the whole reason the request was refused.
    console.error(`${where} — ${body.message}`);
  }

  response.status(body.status).json(body);
};
