import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { IUsersService } from '../interfaces/users-service.interface.js';
import { UnauthorizedError } from '../utils/http-errors/unauthorized.error.js';

const SCHEME = 'Basic ';

/**
 * Credentials arrive as `Authorization: Basic base64(username:password)`.
 *
 * Base64 is encoding, not encryption: over plain http these credentials are
 * readable by anything on the wire. Fly.io forces https, which is what makes
 * this acceptable for a personal app.
 */
export function decodeBasicAuth(header: string | undefined): [string, string] {
  if (!header?.startsWith(SCHEME)) {
    throw new UnauthorizedError('Send credentials as: Authorization: Basic base64(user:password)');
  }

  const decoded = Buffer.from(header.slice(SCHEME.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) throw new UnauthorizedError('Credentials must be "username:password".');

  // Split on the first colon only — a password may legitimately contain one.
  return [decoded.slice(0, separator), decoded.slice(separator + 1)];
}

/**
 * Identifies the caller and leaves them on `response.locals` for the
 * controllers. Every task and config route sits behind this.
 */
export function authenticate(usersService: IUsersService): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const run = async (): Promise<void> => {
      const [username, password] = decodeBasicAuth(request.headers.authorization);
      const user = await usersService.authenticate(username, password);

      response.locals['userId'] = user.id;
      response.locals['username'] = user.username;
    };

    run().then(() => { next(); }).catch((error: unknown) => { next(error); });
  };
}

/** The authenticated user's id. Only call this behind `authenticate`. */
export function currentUserId(response: Response): string {
  const userId = response.locals['userId'] as string | undefined;
  if (userId === undefined) throw new UnauthorizedError();

  return userId;
}
