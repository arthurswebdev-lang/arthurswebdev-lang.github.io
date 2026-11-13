import { type Request } from 'express';

export type QueryRequest<T> = Request<unknown, unknown, unknown, T>;
export type BodyRequest<T, P = unknown> = Request<P, unknown, T, unknown>;
export type ParamsRequest<P> = Request<P, unknown, unknown, unknown>;
/**
 * Both at once: the params say which thing, the query says how. Intersecting
 * the two aliases above does not work — each pins every one of Express's four
 * generics, so the intersection asks for a request whose query is both `Q` and
 * `unknown`, and no handler satisfies it.
 */
export type ParamsQueryRequest<P, Q> = Request<P, unknown, unknown, Q>;
export interface MulterRequest extends Request { file: Express.Multer.File }
