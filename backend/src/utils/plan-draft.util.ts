import { TaskType } from '../enum/task-type.enum.js';
import type { PlanDraft, PlanStep } from '../types/assistant.types.js';
import type { RepeatedTask } from '../types/repeated-tasks.types.js';
import type { Task } from '../types/tasks.types.js';
import { formatClock } from './local-time.util.js';

/**
 * A stored task or repeat back as a draft on the person's clock — the shape
 * the model writes. An edit is a few fields merged onto this, then converted
 * and validated exactly like a new item, so an edit can store nothing a create
 * could not.
 */

const MINUTES_PER_DAY = 1440;

const stepsOf = (steps: { name: string; link?: string }[]): PlanStep[] =>
  steps.map((step) => ('link' in step ? { name: step.name, link: step.link } : { name: step.name }));

function shared(source: Task | RepeatedTask): PlanDraft {
  const draft: PlanDraft = {
    kind: source.type,
    name: source.name,
    category: source.category,
    links: [...source.links],
    steps: stepsOf(source.subtasks),
  };
  if ('photoUrl' in source) draft.photoUrl = source.photoUrl;

  return draft;
}

/** `YYYY-MM-DDTHH:mm` on the person's clock for a stored instant. */
const localDate = (date: Date, offsetMinutes: number) =>
  new Date(date.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 16);

export function taskToDraft(task: Task, offsetMinutes: number): PlanDraft {
  const draft = shared(task);
  if (task.type === TaskType.BASIC) return draft;

  return {
    ...draft,
    date: localDate(task.date, offsetMinutes),
    remindBeforeMins: task.remindBeforeMins,
    activeBeforeMins: task.activeBeforeMins,
    activeForMins: task.activeForMins,
  };
}

/**
 * The stored UTC times back on the person's clock, and the day they move by —
 * the reverse of the shift `buildPayload` applies on the way in.
 */
function localTimes(config: RepeatedTask, offsetMinutes: number) {
  const converted = config.timesOfDay.map(({ hour, minute }) => {
    const local = hour * 60 + minute - offsetMinutes;
    const dayShift = Math.floor(local / MINUTES_PER_DAY);

    return { clock: formatClock(local - dayShift * MINUTES_PER_DAY), dayShift };
  });

  return { times: converted.map(({ clock }) => clock), dayShift: converted[0]?.dayShift ?? 0 };
}

const shiftDays = (days: number[], shift: number) =>
  days.map((day) => (((day + shift) % 7) + 7) % 7).sort((left, right) => left - right);

export function configToDraft(config: RepeatedTask, offsetMinutes: number): PlanDraft {
  const { times, dayShift } = localTimes(config, offsetMinutes);
  const draft: PlanDraft = {
    ...shared(config),
    times,
    enabled: config.enabled,
    remindBeforeMins: config.remindBeforeMins,
    activeBeforeMins: config.activeBeforeMins,
    activeForMins: config.activeForMins,
  };
  if (config.type === TaskType.REPEATED_MONTHLY) {
    return { ...draft, dayOfMonth: config.fromDay + dayShift, months: [...config.months] };
  }

  return { ...draft, weekdays: shiftDays(config.weekdays, dayShift) };
}
