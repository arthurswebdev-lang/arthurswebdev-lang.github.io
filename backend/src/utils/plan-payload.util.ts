import { TaskType } from '../enum/task-type.enum.js';
import { validate } from '../middlewares/validation/util/validation.util.js';
import { ALL_WEEKDAYS } from '../schemes/common.schemes.js';
import { CreateRepeatedTaskSchema } from '../schemes/repeated-tasks.schemes.js';
import { CreateTaskSchema } from '../schemes/tasks.schemes.js';
import type { CreatePayload, PlanDraft } from '../types/assistant.types.js';
import type { TimeOfDay } from '../types/repeated-tasks.types.js';
import { InputValidationError } from './http-errors/input-validation.error.js';
import {
  expandGrid, localDateToUtc, parseClock, toUtcTime,
} from './local-time.util.js';

/**
 * A drafted item (local clock) to the exact body `POST /tasks` or
 * `POST /repeated-tasks` takes, validated by the same Joi schemas those routes
 * use. One source of truth: the assistant cannot store anything the composer
 * could not, and Joi fills the same defaults.
 */

type Body = Record<string, unknown>;

const REPEAT_KINDS = new Set<TaskType>([
  TaskType.REPEATED_DAILY, TaskType.REPEATED_WEEKLY, TaskType.REPEATED_MONTHLY,
]);

export const isRepeatKind = (kind: TaskType): boolean => REPEAT_KINDS.has(kind);

function refuse(message: string): never {
  throw new InputValidationError(message, [message]);
}

/** Fields every kind shares, each copied only when the draft has it. */
function sharedFields(draft: PlanDraft): Body {
  const body: Body = { type: draft.kind, name: draft.name };
  if (draft.category !== undefined) body['category'] = draft.category;
  if (draft.links !== undefined) body['links'] = draft.links;
  if (draft.photoUrl !== undefined) body['photoUrl'] = draft.photoUrl;
  if (draft.steps !== undefined) {
    body['subtasks'] = draft.steps.map((step) => (step.link === undefined
      ? { name: step.name }
      : { name: step.name, link: step.link }));
  }

  return body;
}

function windowFields(draft: PlanDraft): Body {
  const body: Body = {};
  if (draft.remindBeforeMins !== undefined) body['remindBeforeMins'] = draft.remindBeforeMins;
  if (draft.activeBeforeMins !== undefined) body['activeBeforeMins'] = draft.activeBeforeMins;
  if (draft.activeForMins !== undefined) body['activeForMins'] = draft.activeForMins;

  return body;
}

/** The local times a repeat fires at, from `times` or `timeGrid`, sorted. */
export function localTimesOf(draft: PlanDraft): number[] {
  if (draft.timeGrid !== undefined) {
    return expandGrid(draft.timeGrid)
      ?? refuse('"timeGrid" must be from/until/every as HH:mm, with from before until.');
  }

  const times = (draft.times ?? []).map((text) => parseClock(text)
    ?? refuse(`"${text}" is not a time. Use HH:mm, 24-hour clock.`));
  if (times.length === 0) refuse('A repeat needs "times" or "timeGrid".');

  return [...new Set(times)].sort((left, right) => left - right);
}

const shiftWeekdays = (days: number[], shift: number) => days
  .map((day) => (((day + shift) % 7) + 7) % 7)
  .sort((left, right) => left - right);

/**
 * Times converted to UTC, and the one day shift they all share. Times on both
 * sides of UTC midnight would need two different sets of days, which one
 * config cannot hold — except on a repeat that runs every day anyway.
 */
function utcSchedule(draft: PlanDraft, offsetMinutes: number) {
  const converted = localTimesOf(draft).map((local) => toUtcTime(local, offsetMinutes));
  const shifts = new Set(converted.map(({ dayShift }) => dayShift));
  const everyDay = draft.kind === TaskType.REPEATED_DAILY
    && (draft.weekdays ?? ALL_WEEKDAYS).length === 7;
  if (shifts.size > 1 && !everyDay) {
    refuse('These times fall on two different days in UTC for this timezone. '
      + 'Split them into two items: early-morning times in one, the rest in the other.');
  }

  const timesOfDay: TimeOfDay[] = converted.map(({ time }) => time);

  return { timesOfDay, dayShift: converted[0]?.dayShift ?? 0 };
}

function repeatFields(draft: PlanDraft, offsetMinutes: number): Body {
  const { timesOfDay, dayShift } = utcSchedule(draft, offsetMinutes);
  const body: Body = { timesOfDay };

  if (draft.kind === TaskType.REPEATED_MONTHLY) {
    const day = (draft.dayOfMonth ?? refuse('A monthly repeat needs "dayOfMonth".')) + dayShift;
    if (day < 1 || day > 31) {
      refuse('This day and time cross a month boundary in UTC. Pick a later time or another day.');
    }
    body['fromDay'] = day;
    body['months'] = draft.months ?? refuse('A monthly repeat needs "months".');
  } else if (draft.weekdays !== undefined) {
    body['weekdays'] = shiftWeekdays(draft.weekdays, dayShift);
  } else if (draft.kind === TaskType.REPEATED_DAILY) {
    body['weekdays'] = ALL_WEEKDAYS;
  }

  return body;
}

function eventFields(draft: PlanDraft, offsetMinutes: number): Body {
  if (draft.date === undefined) refuse('An EVENT needs "date" as YYYY-MM-DDTHH:mm.');

  const date = localDateToUtc(draft.date, offsetMinutes)
    ?? refuse(`"${draft.date}" is not a date. Use YYYY-MM-DDTHH:mm.`);

  return { date: date.toISOString() };
}

function kindFields(draft: PlanDraft, offsetMinutes: number): Body {
  if (draft.kind === TaskType.BASIC) return {};
  if (draft.kind === TaskType.EVENT) {
    return { ...eventFields(draft, offsetMinutes), ...windowFields(draft) };
  }

  return { ...repeatFields(draft, offsetMinutes), ...windowFields(draft) };
}

/**
 * The body to store, or an `InputValidationError` naming what is wrong — which
 * goes back to the model as a tool error it can fix.
 */
export function buildPayload(draft: PlanDraft, offsetMinutes: number): CreatePayload {
  const body: Body = { ...sharedFields(draft), ...kindFields(draft, offsetMinutes) };
  validate(isRepeatKind(draft.kind) ? CreateRepeatedTaskSchema : CreateTaskSchema, body);

  return body as unknown as CreatePayload;
}

/** JSON with sorted keys, so two equal payloads always print the same. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;

    const entries = Object.entries(inner as Body).sort(([left], [right]) => left.localeCompare(right));

    return Object.fromEntries(entries);
  });
}
