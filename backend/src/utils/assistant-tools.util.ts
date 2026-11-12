import type Anthropic from '@anthropic-ai/sdk';

import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskType } from '../enum/task-type.enum.js';

/**
 * The tools the assistant's model can call — the existing backend API wrapped
 * as small functions (handlers in `assistant-tools.service.ts`).
 *
 * Built once, as module constants, in a fixed order: tools are the first thing
 * in every request and part of the cached prefix, so their bytes must never
 * move. They are deliberately **shaped** like the Joi schemas (same names,
 * same enums) but carry none of the numeric limits — Joi decides, and a
 * refusal goes back to the model as an error it can fix.
 *
 * `strict: true` only on the small tools. The API allows at most 24 optional
 * parameters across all strict tools together, and one plan item alone has 15
 * — in three tools. The item tools are therefore not strict: Joi checks every
 * item fully anyway, and the handlers turn any odd shape into a tool error.
 */
export const MAX_STRICT_OPTIONAL_PARAMS = 24;

export const TOOL = {
  ASK: 'ask_user',
  FIND_TASKS: 'find_tasks',
  FIND_REPEATS: 'find_repeats',
  PROPOSE: 'propose_plan',
  CREATE_TASK: 'create_task',
  CREATE_REPEAT: 'create_repeated_task',
} as const;

const step = {
  type: 'object',
  additionalProperties: false,
  properties: { name: { type: 'string' }, link: { type: 'string' } },
  required: ['name'],
};

const strings = { type: 'array', items: { type: 'string' } };
const integers = { type: 'array', items: { type: 'integer' } };

/** One thing to create, on the person's clock. */
const ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: Object.values(TaskType) },
    name: { type: 'string', description: 'What the person reads in the list.' },
    category: { type: 'string', enum: Object.values(TaskCategory) },
    links: { ...strings, description: 'http(s) links for the whole task.' },
    photoUrl: { type: 'string', description: 'One http(s) picture link.' },
    steps: { type: 'array', items: step, description: 'The checklist. At most one link per step.' },
    date: { type: 'string', description: 'EVENT only. YYYY-MM-DDTHH:mm on the person\'s clock.' },
    times: { ...strings, description: 'Repeats. HH:mm on the person\'s clock. Never UTC.' },
    timeGrid: {
      type: 'object',
      additionalProperties: false,
      description: 'Repeats, instead of times: from/until/every as HH:mm. The server expands it.',
      properties: { from: { type: 'string' }, until: { type: 'string' }, every: { type: 'string' } },
      required: ['from', 'until', 'every'],
    },
    weekdays: { ...integers, description: '0 = Sunday … 6 = Saturday. DAILY and REPEATED_WEEKLY.' },
    dayOfMonth: { type: 'integer', description: 'REPEATED_MONTHLY only. 1-31.' },
    months: { ...integers, description: 'REPEATED_MONTHLY only. 1-12. One month = once a year.' },
    remindBeforeMins: { type: 'integer' },
    activeBeforeMins: { type: 'integer' },
    activeForMins: { type: 'integer' },
  },
  required: ['kind', 'name'],
};

const ASK_USER: Anthropic.Beta.BetaTool = {
  name: TOOL.ASK,
  description: 'Ask the person ONE question and wait for the answer. The app shows a control '
    + 'for the input kind: time picker, date picker, link field with Skip, buttons for choice '
    + '(one) and list (several), or a text box. The answer comes back as this tool\'s result.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      field: { type: 'string', description: 'Short key for the answer, e.g. "date", "bills".' },
      question: { type: 'string' },
      input: { type: 'string', enum: ['text', 'time', 'date', 'url', 'choice', 'list'] },
      options: { ...strings, description: 'For choice and list.' },
    },
    required: ['field', 'question', 'input'],
  },
};

const findSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    query: { type: 'string', description: 'Words to look for in names and steps.' },
    category: { type: 'string', enum: Object.values(TaskCategory) },
  },
  required: [],
};

const FIND_TASKS: Anthropic.Beta.BetaTool = {
  name: TOOL.FIND_TASKS,
  description: 'The person\'s existing tasks (at most 20 short rows). Read-only.',
  strict: true,
  input_schema: findSchema,
};

const FIND_REPEATS: Anthropic.Beta.BetaTool = {
  name: TOOL.FIND_REPEATS,
  description: 'The person\'s existing repeats (at most 20 short rows). Read-only. Use it before '
    + 'proposing repeats that might already exist, such as gym exercises.',
  strict: true,
  input_schema: findSchema,
};

const PROPOSE_PLAN: Anthropic.Beta.BetaTool = {
  name: TOOL.PROPOSE,
  description: 'Validate the items and show the person the compact plan with Change and Accept '
    + 'buttons. Saves nothing. If an item is refused you get the reason; fix it and call again. '
    + 'A new call replaces the previous plan.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: { type: 'array', items: ITEM },
      assumptions: {
        ...strings,
        description: 'Short notes on what you chose that the person did not say.',
      },
    },
    required: ['items', 'assumptions'],
  },
};

const createSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    planItem: { type: 'integer', description: 'The item number in the accepted plan.' },
    item: ITEM,
  },
  required: ['planItem', 'item'],
};

const CREATE_TASK: Anthropic.Beta.BetaTool = {
  name: TOOL.CREATE_TASK,
  description: 'Save one BASIC or EVENT plan item. Works only after the person tapped Accept, '
    + 'and only with the item exactly as it was in the accepted plan.',
  input_schema: createSchema,
};

const CREATE_REPEATED_TASK: Anthropic.Beta.BetaTool = {
  name: TOOL.CREATE_REPEAT,
  description: 'Save one DAILY, REPEATED_WEEKLY or REPEATED_MONTHLY plan item. Works only after '
    + 'the person tapped Accept, and only with the item exactly as it was in the accepted plan.',
  input_schema: createSchema,
};

/** Always the same six, in the same order, so the prompt cache holds. */
export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  ASK_USER, FIND_TASKS, FIND_REPEATS, PROPOSE_PLAN, CREATE_TASK, CREATE_REPEATED_TASK,
];
