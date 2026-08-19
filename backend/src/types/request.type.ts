import { type Request } from 'express';

export type QueryRequest<T> = Request<unknown, unknown, unknown, T>;
export type BodyRequest<T, P = unknown> = Request<P, unknown, T, unknown>;
export type ParamsRequest<P> = Request<P, unknown, unknown, unknown>;
export interface MulterRequest extends Request { file: Express.Multer.File }
