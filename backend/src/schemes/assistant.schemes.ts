import Joi from 'joi';

import { TEMPLATES } from '../prompts/assistant-templates.js';
import type { AcceptPlan, SendMessage, StartSession } from '../types/assistant.types.js';
import { ID, JoiObject } from '../middlewares/validation/util/validation.util.js';

/**
 * `Date#getTimezoneOffset()` from the device: minutes to add to local time to
 * get UTC. Real zones lie within UTC-12 and UTC+14.
 */
const timezoneOffsetMinutes = Joi.number().integer().min(-14 * 60).max(12 * 60).required();

/** A pasted page longer than this is too long for a phone chat anyway. */
const message = Joi.string().trim().min(1).max(4000);

export const StartSessionSchema = JoiObject<StartSession>({
  templateId: Joi.string().valid(...TEMPLATES.map((template) => template.id)),
  message,
  timezoneOffsetMinutes,
}).or('templateId', 'message');

export const SendMessageSchema = JoiObject<SendMessage>({
  message: message.required(),
  timezoneOffsetMinutes,
});

export const AcceptPlanSchema = JoiObject<AcceptPlan>({ timezoneOffsetMinutes });

export const SessionIdInParams = Joi.object({ id: ID.required() });
