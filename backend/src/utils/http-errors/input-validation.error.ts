import { HttpStatusCodes } from '../http-status-codes.util.js';
import { HttpException } from './http.exception.js';

/**
 * Raised when a request payload fails schema validation. `errors` holds one
 * entry per failing field so the response can list them all.
 */
export class InputValidationError extends HttpException {
  readonly errors: readonly string[];

  constructor(message = 'BAD_REQUEST', errors: readonly string[] = []) {
    super(HttpStatusCodes.BAD_REQUEST, message);

    this.errors = errors;
  }
}
