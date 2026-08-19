import { HttpStatusCodes } from '../http-status-codes.util.js';
import { HttpException } from './http.exception.js';

/** No credentials, or credentials that do not match a user. */
export class UnauthorizedError extends HttpException {
  constructor(message = 'UNAUTHORIZED') {
    super(HttpStatusCodes.UNAUTHORIZED, message);
  }
}
