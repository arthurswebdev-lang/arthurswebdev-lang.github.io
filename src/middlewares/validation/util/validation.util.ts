import { type Request } from 'express';
import Joi, { type Schema, type StrictSchemaMap, type ValidationOptions } from 'joi';

import { InputValidationError } from '../../../utils/http-errors/input-validation.error.js';

const passwordPattern = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?\d)(?=.*?[#?!@$%^&*-]).{7,}$/;
const passwordError = "password must contain at least 1 uppercase, 1 lowercase, 1 number and 1 special char '#?!@$%^&*-'";

// Reporting every broken field at once is friendlier than stopping at the
// first one; callers can still override per validate() call.
const defaultOptions: ValidationOptions = { abortEarly: false, convert: true };

// Types
export const ID = Joi.string().uuid({ version: 'uuidv4' });
export const IDs = Joi.array().items(ID);
export const count = Joi.number().min(0).integer();
export const varchar = (minLen: number, maxLen: number) => Joi.string().min(minLen).max(maxLen);
export const text = Joi.string();
export const flag = Joi.boolean();
export const isoDate = Joi.date().iso();
export const email = Joi.string().email();
export const limit = Joi.number().min(1).default(20);
export const page = Joi.number().min(0).default(0);
export const password = varchar(8, 20)
  .regex(passwordPattern)
  .messages({ 'string.pattern.base': passwordError });

// Schemes
export const IdInParams = Joi.object({ id: ID.required() });

export function JoiObject<T>(schema?: StrictSchemaMap<T>): Joi.ObjectSchema<T> {
  return Joi.object<T, true, T>(schema);
}

/**
 * Validates `data` against `schema` and throws `InputValidationError` when it
 * does not match.
 *
 * On success the validated result (coerced values, applied defaults) is copied
 * back onto `data` in place, so `req.body` and `req.params` reach the
 * controller already converted. Use `validateQuery` for `req.query`.
 */
export function validate(schema: Schema, data: object, options?: ValidationOptions): void {
  const result: Joi.ValidationResult<unknown> = schema.validate(data, {
    ...defaultOptions,
    ...options,
  });

  if (result.error !== undefined) {
    const errors = result.error.details.map((detail) => detail.message);
    throw new InputValidationError(errors.join(', '), errors);
  }

  Object.assign(data, result.value);
}

/**
 * `req.query` variant of `validate`.
 *
 * Express 5 serves `req.query` from a getter that re-parses the query string on
 * every read, so mutating the returned object is thrown away. Validating a copy
 * and pinning it back with defineProperty is what makes the coerced values and
 * defaults visible to the controller.
 */
export function validateQuery(
  request: Request,
  schema: Schema,
  options?: ValidationOptions,
): void {
  const query: Record<string, unknown> = { ...request.query };

  validate(schema, query, options);

  Object.defineProperty(request, 'query', {
    value: query,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}
