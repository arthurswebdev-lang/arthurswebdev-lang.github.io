import type { HttpStatusCodes } from '../http-status-codes.util.js';

/** Base class for every error that maps onto an HTTP response. */
export class HttpException extends Error {
  readonly status: HttpStatusCodes;

  constructor(status: HttpStatusCodes, message: string) {
    super(message);

    // new.target keeps the name accurate for subclasses without each of them
    // having to repeat the assignment.
    this.name = new.target.name;
    this.status = status;
  }
}
