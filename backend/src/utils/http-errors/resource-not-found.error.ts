import { HttpStatusCodes } from '../http-status-codes.util.js';
import { HttpException } from './http.exception.js';

/** Raised when a lookup succeeds as a query but matches no resource. */
export class ResourceNotFoundError extends HttpException {
  constructor(message = 'NOT_FOUND') {
    super(HttpStatusCodes.NOT_FOUND, message);
  }
}
