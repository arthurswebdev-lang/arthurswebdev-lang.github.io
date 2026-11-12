import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import type { IRepeatedTasksService } from '../interfaces/repeated-tasks-service.interface.js';
import type { ITasksService } from '../interfaces/tasks-service.interface.js';
import type {
  AnswerInput, AskControl, AssistantSession, CreatedItem, PlanDraft, PlanItem, ToolUseBlock,
} from '../types/assistant.types.js';
import type { CreateRepeatedTask, RepeatedTask } from '../types/repeated-tasks.types.js';
import type { CreateTask, Task } from '../types/tasks.types.js';
import { TOOL } from '../utils/assistant-tools.util.js';
import { InputValidationError } from '../utils/http-errors/input-validation.error.js';
import { formatClock } from '../utils/local-time.util.js';
import { buildPayload, canonical, isRepeatKind } from '../utils/plan-payload.util.js';
import { renderPlan } from '../utils/plan-render.util.js';

/**
 * The handlers behind the assistant's tools: the existing services, called
 * in-process with the user id from Basic auth — never from the model, whose
 * tool schemas have no user field at all.
 *
 * The model can ask, read and draft freely. It can **save** only through the
 * two create tools, and those refuse unless the session is `accepted` and the
 * item matches the accepted plan exactly. That check is what makes "what you
 * read is what gets saved" true even though the model makes the call.
 */

/** What one tool call produced, before it becomes a `tool_result`. */
export type ToolOutcome =
  | { kind: 'result'; content: string; isError?: boolean }
  | { kind: 'ask'; ask: AskControl }
  | { kind: 'plan'; text: string }
  | { kind: 'created'; content: string; created: CreatedItem };

/** State shared by every tool call in one request. */
export interface ToolContext {
  session: AssistantSession;
  /** Rejected plans this request — the second one tells the model to stop. */
  rejections: number;
}

const MAX_ROWS = 20;
const ANSWER_INPUTS = new Set<string>(['text', 'time', 'date', 'url', 'choice', 'list']);
const CATEGORIES = new Set<string>(Object.values(TaskCategory));

const error = (content: string): ToolOutcome => ({ kind: 'result', content, isError: true });

function asRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
}

const stringOf = (value: unknown) => (typeof value === 'string' ? value : '');

function categoryOf(value: unknown): TaskCategory | undefined {
  return typeof value === 'string' && CATEGORIES.has(value) ? value as TaskCategory : undefined;
}

/** Local `YYYY-MM-DD HH:mm` for a stored UTC instant. */
const localStamp = (date: Date, offsetMinutes: number) =>
  new Date(date.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 16).replace('T', ' ');

const localClock = (hour: number, minute: number, offsetMinutes: number) =>
  formatClock((((hour * 60 + minute - offsetMinutes) % 1440) + 1440) % 1440);

function matches(query: string, names: string[]): boolean {
  const needle = query.trim().toLowerCase();

  return needle === '' || names.some((name) => name.toLowerCase().includes(needle));
}

function taskRow(task: Task, offsetMinutes: number): string {
  const when = task.type === TaskType.EVENT ? ` · ${localStamp(task.date, offsetMinutes)}` : '';
  const origin = task.type === TaskType.EVENT && task.configTaskId !== null ? ' · from a repeat' : '';

  return `${task.name} · ${task.type} · ${task.category} · ${task.status}${when}${origin}`;
}

function repeatRow(config: RepeatedTask, offsetMinutes: number): string {
  const times = config.timesOfDay
    .map(({ hour, minute }) => localClock(hour, minute, offsetMinutes)).join(', ');
  const days = config.type === TaskType.REPEATED_MONTHLY
    ? `day ${String(config.fromDay)} of months ${config.months.join(',')}`
    : `weekdays ${config.weekdays.join(',')}`;
  const paused = config.enabled ? '' : ' · paused';

  return `${config.name} · ${config.type} · ${config.category} · ${days} · ${times}${paused}`;
}

const rowsResult = (rows: string[]): ToolOutcome => ({
  kind: 'result',
  content: rows.length === 0 ? 'Nothing found.' : rows.slice(0, MAX_ROWS).join('\n'),
});

function askOf(input: Record<string, unknown>): ToolOutcome {
  const kind = stringOf(input['input']);
  const ask: AskControl = {
    field: stringOf(input['field']) || 'answer',
    question: stringOf(input['question']),
    input: (ANSWER_INPUTS.has(kind) ? kind : 'text') as AnswerInput,
  };
  if (Array.isArray(input['options'])) ask.options = input['options'].map(String);

  return ask.question === '' ? error('"question" is empty.') : { kind: 'ask', ask };
}

const draftsOf = (value: unknown): PlanDraft[] =>
  (Array.isArray(value) ? value.map((item) => item as PlanDraft) : []);

/** Each draft converted and validated, or the reasons the server refused. */
function planItems(drafts: PlanDraft[], offsetMinutes: number) {
  const items: PlanItem[] = [];
  const problems: string[] = [];
  drafts.forEach((draft, index) => {
    try {
      items.push({ number: index + 1, draft, payload: buildPayload(draft, offsetMinutes) });
    } catch (caught) {
      if (!(caught instanceof InputValidationError)) throw caught;
      problems.push(`Item ${String(index + 1)} (${draft.name}): ${caught.message}`);
    }
  });

  return { items, problems };
}

function proposeOutcome(input: Record<string, unknown>, context: ToolContext): ToolOutcome {
  const { session } = context;
  const drafts = draftsOf(input['items']);
  if (drafts.length === 0) return error('A plan needs at least one item.');

  const { items, problems } = planItems(drafts, session.offsetMinutes);
  if (problems.length > 0) {
    context.rejections += 1;
    const stop = context.rejections >= 2
      ? ' Do not call propose_plan again now; tell the person in plain words what was refused.'
      : ' Fix these items and call propose_plan again.';

    return error(`Refused. ${problems.join(' | ')}.${stop}`);
  }

  session.plan = items;
  session.state = 'proposed';
  const assumptions = Array.isArray(input['assumptions']) ? input['assumptions'].map(String) : [];

  return { kind: 'plan', text: renderPlan(items, assumptions) };
}

interface CreateCheck {
  item: PlanItem;
  repeat: boolean;
}

/** Every reason a create call may not save, in the order they are checked. */
function checkCreate(
  name: string,
  input: Record<string, unknown>,
  session: AssistantSession,
): CreateCheck | string {
  if (session.state !== 'accepted') {
    return 'Not accepted yet. Show the plan with propose_plan and ask the person to tap Accept.';
  }
  const number = Number(input['planItem']);
  const item = session.plan?.find((candidate) => candidate.number === number);
  if (item === undefined) return `There is no plan item ${String(number)}.`;
  if (item.createdId !== undefined) return `Plan item ${String(number)} is already saved.`;

  const repeat = isRepeatKind(item.draft.kind);
  if (repeat !== (name === TOOL.CREATE_REPEAT)) {
    return `Plan item ${String(number)} needs ${repeat ? TOOL.CREATE_REPEAT : TOOL.CREATE_TASK}.`;
  }

  return { item, repeat };
}

/** True when the call's item converts to exactly the accepted payload. */
function sameAsAccepted(item: PlanItem, sent: unknown, offsetMinutes: number): boolean {
  try {
    return canonical(buildPayload(sent as PlanDraft, offsetMinutes)) === canonical(item.payload);
  } catch (caught) {
    if (caught instanceof InputValidationError) return false;
    throw caught;
  }
}

export class AssistantToolsService {
  constructor(
    private readonly tasksService: ITasksService,
    private readonly repeatedTasksService: IRepeatedTasksService,
  ) {}

  /** Runs one tool call. Never throws for a bad call — that is a tool error. */
  async run(use: ToolUseBlock, context: ToolContext): Promise<ToolOutcome> {
    const input = asRecord(use.input);
    switch (use.name) {
      case TOOL.ASK: return askOf(input);
      case TOOL.FIND_TASKS: return this.findTasks(input, context.session);
      case TOOL.FIND_REPEATS: return this.findRepeats(input, context.session);
      case TOOL.PROPOSE: return proposeOutcome(input, context);
      case TOOL.CREATE_TASK:
      case TOOL.CREATE_REPEAT: return this.create(use.name, input, context.session);
      default: return error(`Unknown tool "${use.name}".`);
    }
  }

  private async findTasks(input: Record<string, unknown>, session: AssistantSession) {
    const category = categoryOf(input['category']);
    const tasks = await this.tasksService.listAll({
      userId: session.userId, ...(category === undefined ? {} : { category }),
    });
    const query = stringOf(input['query']);
    const found = tasks.filter((task) => matches(query, [task.name, ...task.subtasks.map((step) => step.name)]));

    return rowsResult(found.map((task) => taskRow(task, session.offsetMinutes)));
  }

  private async findRepeats(input: Record<string, unknown>, session: AssistantSession) {
    const category = categoryOf(input['category']);
    const configs = await this.repeatedTasksService.listAll(session.userId);
    const query = stringOf(input['query']);
    const found = configs
      .filter((config) => category === undefined || config.category === category)
      .filter((config) => matches(query, [config.name, ...config.subtasks.map((step) => step.name)]));

    return rowsResult(found.map((config) => repeatRow(config, session.offsetMinutes)));
  }

  private async create(
    name: string,
    input: Record<string, unknown>,
    session: AssistantSession,
  ): Promise<ToolOutcome> {
    const check = checkCreate(name, input, session);
    if (typeof check === 'string') return error(check);

    const { item, repeat } = check;
    if (!sameAsAccepted(item, input['item'], session.offsetMinutes)) {
      return error(`This does not match accepted plan item ${String(item.number)}. `
        + `Send exactly: ${JSON.stringify(item.draft)}`);
    }

    return this.save(item, repeat, session.userId);
  }

  private async save(item: PlanItem, repeat: boolean, userId: string): Promise<ToolOutcome> {
    const payload = structuredClone(item.payload);
    const stored = repeat
      ? await this.repeatedTasksService.create(payload as CreateRepeatedTask, userId)
      : await this.tasksService.create(payload as CreateTask, userId);
    item.createdId = stored.id;
    const created: CreatedItem = {
      resource: repeat ? 'repeated-task' : 'task', id: stored.id, name: stored.name,
    };

    return { kind: 'created', content: `Saved plan item ${String(item.number)}.`, created };
  }
}
