import Joi from 'joi';

import { JoiObject } from '../middlewares/validation/util/validation.util.js';
import type { RegisterDevice } from '../types/device.types.js';

/**
 * An FCM registration token is an opaque string from Google with no documented
 * format or length, so there is nothing to check beyond "present, and not
 * absurd". The ceiling is deliberately generous: tokens have grown over the
 * years, and rejecting a valid one would silently cost the user every alert.
 */
export const RegisterDeviceSchema = JoiObject<RegisterDevice>({
  token: Joi.string().trim().min(20).max(4096)
    .required(),
});
