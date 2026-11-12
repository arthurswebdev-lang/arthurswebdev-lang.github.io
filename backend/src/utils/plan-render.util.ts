import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import type {
  CreatePayload, PlanChange, PlanDraft, PlanItem,
} from '../types/assistant.types.js';
import { formatClock, parseClock } from './local-time.util.js';
import {
  buildPayload, canonical, isRepeatKind, localTimesOf,
} from './plan-payload.util.js';

/**
 * The compact plan the person reads before tapping Accept.
 *
 * Rendered by code, not written by the model, so the text and the data cannot
 * disagree: every line comes from the validated payload, or from the draft's
 * local times that payload was converted from. What it says is what is stored.
 */

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  [TaskCategory.IMPORTANT]: 'Important',
  [TaskCategory.WORK]: 'Work',
  [TaskCategory.SUPPLEMENTS]: 'Supplements',
  [TaskCategory.FOOD]: 'Food',
  [TaskCategory.EDUCATION]: 'Education',
  [TaskCategory.SELFCARE]: 'Selfcare',
  [TaskCategory.GYM]: 'Gym',
  [TaskCategory.READING]: 'Reading',
  [TaskCategory.OTHER]: 'Other',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** Monday first, the way a week is read here; Sunday last. */
const weekOrder = (day: number) => (day + 6) % 7;

const MINUTES_PER_DAY = 1440;

/** 1440 → "1 day", 120 → "2 h", 90 → "90 min". */
export function formatDuration(minutes: number): string {
  if (minutes >= MINUTES_PER_DAY && minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;

    return `${String(days)} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) return `${String(minutes / 60)} h`;

  return `${String(minutes)} min`;
}

const ordinal = (day: number) => {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${String(day)}th`;

  return `${String(day)}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
};

/** The even step between times, or null when the gaps differ. Three times at least. */
function evenStep(minutes: number[]): number | null {
  const [first, second] = minutes;
  if (minutes.length < 3 || first === undefined || second === undefined) return null;

  const step = second - first;

  return minutes.every((value, index) => index === 0 || value - (minutes[index - 1] ?? 0) === step)
    ? step
    : null;
}

/**
 * Evenly spaced times read as the window they are — "every 1 h, 07:00–23:00",
 * the way the composer's "Fill a day" reopens them; other long lists are
 * shortened: "09:00, 11:00 … 21:00 (7 times)".
 */
function timesText(minutes: number[]): string {
  const clocks = minutes.map(formatClock);
  const step = evenStep(minutes);
  if (step !== null) {
    return `every ${formatDuration(step)}, ${clocks[0] ?? ''}–${clocks.at(-1) ?? ''} (${String(clocks.length)} times)`;
  }
  if (clocks.length <= 4) return clocks.join(', ');

  return `${clocks[0] ?? ''}, ${clocks[1] ?? ''} … ${clocks.at(-1) ?? ''} (${String(clocks.length)} times)`;
}

const daysText = (days: number[]) => [...days]
  .sort((left, right) => weekOrder(left) - weekOrder(right))
  .map((day) => DAY_NAMES[day] ?? '?')
  .join(', ');

function monthlyText(item: PlanItem, at: string): string {
  const day = item.draft.dayOfMonth ?? 1;
  const months = item.draft.months ?? [];
  if (months.length === 12) return `Every month on the ${ordinal(day)}, ${at}`;
  if (months.length === 1) {
    return `Every year on ${String(day)} ${MONTH_NAMES[(months[0] ?? 1) - 1] ?? ''}, ${at}`;
  }
  const names = months.map((month) => (MONTH_NAMES[month - 1] ?? '').slice(0, 3)).join(', ');

  return `On the ${ordinal(day)} of ${names}, ${at}`;
}

function eventText(date: string): string {
  const [day = '', clock = ''] = date.split('T');
  const [year = 0, month = 1, dayOfMonth = 1] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  const minutes = parseClock(clock) ?? 0;

  return `${DAY_NAMES[weekday] ?? ''} ${String(dayOfMonth)} ${MONTH_NAMES[month - 1] ?? ''} ${String(year)}, ${formatClock(minutes)}`;
}

/** When it happens, in words, on the person's clock. */
export function whenText(item: PlanItem): string {
  const { draft } = item;
  if (draft.kind === TaskType.BASIC) return 'No date — always in Actual';
  if (draft.kind === TaskType.EVENT) return eventText(draft.date ?? '');

  const at = timesText(localTimesOf(draft));
  if (draft.kind === TaskType.REPEATED_MONTHLY) return monthlyText(item, at);

  const days = draft.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
  // "Mon at 06:00", but "Mon, every 2 h, 09:00–21:00".
  const joiner = at.startsWith('every') ? ', ' : ' at ';

  return days.length === 7 ? `Every day${joiner}${at}` : `${daysText(days)}${joiner}${at}`;
}

interface WindowView {
  remindBeforeMins: number;
  activeBeforeMins: number;
  activeForMins: number;
}

/** Only the three window fields — never the whole payload, which carries the name. */
function windowOf(payload: CreatePayload): WindowView | null {
  if (!('activeForMins' in payload)) return null;

  const { remindBeforeMins, activeBeforeMins, activeForMins } = payload as unknown as WindowView;

  return { remindBeforeMins, activeBeforeMins, activeForMins };
}

/** "Push on time · shows 1 day before · stays open 3 days · Important". */
function detailsText(payload: CreatePayload): string {
  const parts: string[] = [];
  const window = windowOf(payload);
  if (window !== null) {
    parts.push(window.remindBeforeMins === 0
      ? 'Push on time'
      : `Push ${formatDuration(window.remindBeforeMins)} before`);
    if (window.activeBeforeMins > 0) parts.push(`shows ${formatDuration(window.activeBeforeMins)} before`);
    parts.push(`stays open ${formatDuration(window.activeForMins)}`);
  }
  parts.push(CATEGORY_LABEL[payload.category ?? TaskCategory.OTHER]);

  return parts.join(' · ');
}

const MAX_STEPS_SHOWN = 8;

function stepsText(payload: CreatePayload): string | null {
  const steps = payload.subtasks ?? [];
  if (steps.length === 0) return null;

  const names = steps.map((step) => (step.link === undefined ? step.name : `${step.name} 🔗`));
  const shown = names.length > MAX_STEPS_SHOWN
    ? [...names.slice(0, MAX_STEPS_SHOWN - 2), `… +${String(names.length - MAX_STEPS_SHOWN + 2)} more`]
    : names;

  return `Steps: ${shown.join(' · ')}`;
}

function extrasText(payload: CreatePayload): string | null {
  const parts = (payload.links ?? []).map((link) => `🔗 ${new URL(link).hostname}`);
  if (payload.photoUrl !== undefined) parts.push('🖼 photo');

  return parts.length === 0 ? null : parts.join(' · ');
}

const ICON: Record<string, string> = { [TaskType.BASIC]: '📋', [TaskType.EVENT]: '📅' };
const iconOf = (kind: TaskType) => ICON[kind] ?? '🔁';

function itemBlock(item: PlanItem): string {
  const details = [
    whenText(item),
    stepsText(item.payload),
    detailsText(item.payload),
    extrasText(item.payload),
  ].filter((line): line is string => line !== null);
  const title = `${String(item.number)}. ${iconOf(item.draft.kind)} ${item.draft.name}`;

  return [title, ...details.map((line) => `   ${line}`)].join('\n');
}

/**
 * What a weekly item shares with its neighbours — everything but the name and
 * the days. Equal keys are what lets a gym plan read as one block.
 */
function groupKey(item: PlanItem): string | null {
  if (item.draft.kind !== TaskType.REPEATED_WEEKLY) return null;

  return canonical({
    times: localTimesOf(item.draft),
    window: windowOf(item.payload),
    category: item.payload.category,
    steps: (item.payload.subtasks ?? []).map((step) => step.name),
  });
}

/** Three or more like weekly items share one block, laid out by weekday. */
function groupBlock(items: PlanItem[]): string {
  const [first] = items;
  if (first === undefined) return '';

  const shared = [timesText(localTimesOf(first.draft)), stepsText(first.payload), detailsText(first.payload)]
    .filter((part): part is string => part !== null);
  const rows = [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const names = items.filter((item) => (item.draft.weekdays ?? []).includes(day))
      .map((item) => item.draft.name);

    return names.length === 0 ? null : `   ${DAY_NAMES[day] ?? ''}  ${names.join(' · ')}`;
  }).filter((row): row is string => row !== null);
  const numbers = items.map((item) => String(item.number)).join(', ');

  return [`🔁 ${String(items.length)} weekly repeats (items ${numbers})`, `   All: ${shared.join(' · ')}`, ...rows].join('\n');
}

function blocksOf(items: PlanItem[]): string[] {
  const groups = new Map<string, PlanItem[]>();
  for (const item of items) {
    const key = groupKey(item);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const grouped = new Set([...groups.values()].filter((group) => group.length >= 3).flat());
  const blocks = items.filter((item) => !grouped.has(item)).map(itemBlock);
  for (const group of groups.values()) if (group.length >= 3) blocks.push(groupBlock(group));

  return blocks;
}

/** A draft's details as the plan would print them, or null if they cannot be read. */
function viewOf(draft: PlanDraft) {
  try {
    const item: PlanItem = { number: 0, draft, payload: buildPayload(draft, 0) };

    return {
      when: whenText(item),
      steps: stepsText(item.payload) ?? 'no steps',
      details: detailsText(item.payload),
      extras: extrasText(item.payload) ?? 'no links',
    };
  } catch {
    return null;
  }
}

function pauseLine(change: PlanChange): string | null {
  const { before, after } = change;
  if (after.enabled === undefined || after.enabled === before.enabled) return null;

  return after.enabled ? '▶ Resume it' : '⏸ Pause it — it keeps everything and can be resumed';
}

const statusLine = (change: PlanChange) => (change.status === undefined
  ? null
  : `Mark as ${change.status === TaskStatus.DONE ? 'done' : 'not done'}`);

/** Only what changes, as "before → after", one line each. */
function changeLines(change: PlanChange): string[] {
  if (change.statusOnly) return [statusLine(change) ?? 'No visible change'];

  const lines: string[] = [];
  if (change.before.name !== change.after.name) lines.push(`Name: ${change.before.name} → ${change.after.name}`);
  const before = viewOf(change.before);
  const after = viewOf(change.after);
  if (before !== null && after !== null) {
    for (const key of ['when', 'steps', 'details', 'extras'] as const) {
      if (before[key] !== after[key]) lines.push(`${before[key]} → ${after[key]}`);
    }
  }
  for (const line of [pauseLine(change), statusLine(change)]) if (line !== null) lines.push(line);

  return lines.length === 0 ? ['No visible change'] : lines;
}

function changeBlock(change: PlanChange): string {
  const what = change.target === 'repeat' ? 'repeat' : 'task';
  const title = `${String(change.number)}. ✏️ ${change.before.name} (${what})`;

  return [title, ...changeLines(change).map((line) => `   ${line}`)].join('\n');
}

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

const countText = (items: PlanItem[], changes: PlanChange[]) => {
  const repeats = items.filter((item) => isRepeatKind(item.draft.kind)).length;
  const others = items.length - repeats;
  const parts = [];
  if (others > 0) parts.push(plural(others, 'task', 'tasks'));
  if (repeats > 0) parts.push(plural(repeats, 'repeat', 'repeats'));
  if (changes.length > 0) parts.push(plural(changes.length, 'change', 'changes'));

  return parts.join(' + ');
};

/** The whole plan, as the person will read it: new items first, then changes. */
export function renderPlan(
  items: PlanItem[],
  assumptions: string[],
  changes: PlanChange[] = [],
): string {
  const blocks = [...blocksOf(items), ...changes.map(changeBlock)];
  const lines = [`📋 Plan — ${countText(items, changes)}`, '', blocks.join('\n\n')];
  if (assumptions.length > 0) {
    lines.push('', 'I decided myself:', ...assumptions.map((note) => `• ${note}`));
  }

  return lines.join('\n');
}
