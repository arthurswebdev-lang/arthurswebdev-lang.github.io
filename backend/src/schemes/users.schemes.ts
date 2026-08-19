import Joi from 'joi';

import { JoiObject } from '../middlewares/validation/util/validation.util.js';
import type { CreateUser } from '../types/user.types.js';

/**
 * Signup asks for a username and a password and nothing else — no email, no
 * confirmation. The only rule is that the username is free.
 */
export const SignUpSchema = JoiObject<CreateUser>({
  username: Joi.string().trim().lowercase().min(3)
    .max(32)
    .pattern(/^[a-z0-9._-]+$/)
    .required()
    .messages({
      'string.pattern.base': 'username may use letters, digits, dot, underscore and dash only',
    }),
  // No length rules by request — letters and digits only. Express caps the
  // request body at 100kb, so there is no need for a max here.
  password: Joi.string().pattern(/^[a-zA-Z0-9]+$/).required().messages({
    'string.pattern.base': 'password may use letters and digits only',
  }),
});
