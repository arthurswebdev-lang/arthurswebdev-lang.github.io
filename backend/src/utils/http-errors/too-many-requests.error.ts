import { HttpStatusCodes } from '../http-status-codes.util.js';
import { HttpException } from './http.exception.js';

/** The caller has used up an allowance, such as the assistant's daily messages. */
export class TooManyRequestsError extends HttpException {
  constructor(message = 'TOO_MANY_REQUESTS') {
    super(HttpStatusCodes.TOO_MANY_REQUESTS, message);
  }
}
