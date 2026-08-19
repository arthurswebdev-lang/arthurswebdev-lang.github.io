import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * The page is served by GitHub Pages and the API by fly.io, so every request
 * from the app is cross-origin.
 *
 * Credentials travel in the Authorization header rather than a cookie, so a
 * permissive origin does not expose anything a browser would attach on its
 * own — a caller still needs the username and password.
 */
export function cors(allowedOrigins: string[]): RequestHandler {
  const allowAny = allowedOrigins.length === 0 || allowedOrigins.includes('*');

  return (request: Request, response: Response, next: NextFunction): void => {
    const { origin } = request.headers;

    if (allowAny) {
      response.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin !== undefined && allowedOrigins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      // The response differs per origin, so caches must key on it.
      response.setHeader('Vary', 'Origin');
    }

    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    response.setHeader('Access-Control-Max-Age', '86400');

    // A preflight never reaches a route; answer it here and stop.
    if (request.method === 'OPTIONS') {
      response.sendStatus(204);

      return;
    }

    next();
  };
}
