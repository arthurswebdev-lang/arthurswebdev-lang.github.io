import { HttpStatusCodes } from '../http-status-codes.util.js';
import { HttpException } from './http.exception.js';

/** A feature that needs configuration this deployment does not have. */
export class ServiceUnavailableError extends HttpException {
  constructor(message = 'SERVICE_UNAVAILABLE') {
    super(HttpStatusCodes.SERVICE_UNAVAILABLE, message);
  }
}
