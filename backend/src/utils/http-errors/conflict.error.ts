import { HttpStatusCodes } from '../http-status-codes.util.js';
import { HttpException } from './http.exception.js';

/** The request is valid but collides with something already stored. */
export class ConflictError extends HttpException {
  constructor(message = 'CONFLICT') {
    super(HttpStatusCodes.CONFLICT, message);
  }
}
