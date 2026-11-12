import { randomUUID } from 'node:crypto';

import type { IAssistantClient } from '../interfaces/assistant-client.interface.js';
import type { IAssistantService } from '../interfaces/assistant-service.interface.js';
import type {
  IAssistantSessionsRepository, IAssistantUsageRepository,
} from '../interfaces/assistant-sessions-repository.interface.js';
import { templateById, templateSummaries } from '../prompts/assistant-templates.js';
import type {
  AcceptPlan, AskControl, AssistantHealth, AssistantReply, AssistantSession, ContentBlock, CreatedItem,
  SendMessage, StartSession, TemplateSummary, ToolResultBlockParam, ToolUseBlock,
} from '../types/assistant.types.js';
import { ConflictError } from '../utils/http-errors/conflict.error.js';
import { InputValidationError } from '../utils/http-errors/input-validation.error.js';
import { ResourceNotFoundError } from '../utils/http-errors/resource-not-found.error.js';
import { TooManyRequestsError } from '../utils/http-errors/too-many-requests.error.js';
import { describeNow } from '../utils/local-time.util.js';
import type { AssistantToolsService, ToolContext, ToolOutcome } from './assistant-tools.service.js';

/** Model calls in one request. Stops a model that misreads a rule from looping. */
const MAX_MODEL_CALLS = 4;
/** Past this the history is rebuilt from the stored answers and plan. */
export const MAX_SESSION_MESSAGES = 40;
/** Requests per user per day, so a stuck client cannot spend real money. */
const DAILY_LIMIT = 100;
/** Idle time before Mongo's TTL index deletes a session. */
const IDLE_MS = 30 * 60 * 1000;

const STOPPED = 'Sorry, I could not answer that. Try saying it another way.';
/** How long one health answer is reused, so opening the chat is free. */
const HEALTH_TTL_MS = 60 * 1000;

interface Pause {
  toolUseId: string;
  outcome: Extract<ToolOutcome, { kind: 'ask' | 'plan' }>;
}

interface TurnEnd {
  texts: string[];
  pause: Pause | null;
  created: CreatedItem[];
}

const isToolUse = (block: ContentBlock): block is ToolUseBlock => block.type === 'tool_use';

const textOf = (content: ContentBlock[]) => content
  .flatMap((block) => (block.type === 'text' ? [block.text.trim()] : []))
  .filter((text) => text !== '')
  .join('\n\n');

const isPause = (outcome: ToolOutcome): outcome is Pause['outcome'] =>
  outcome.kind === 'ask' || outcome.kind === 'plan';

function toResult(use: ToolUseBlock, outcome: ToolOutcome): ToolResultBlockParam {
  const content = outcome.kind === 'result' || outcome.kind === 'created'
    ? outcome.content
    : 'Only one question or plan at a time. This one was not shown; send it later.';
  const isError = outcome.kind === 'result' ? outcome.isError === true : outcome.kind !== 'created';

  return { type: 'tool_result', tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) };
}

/** What the model is told when the person answers the call it is waiting on. */
function awaitedResult(session: AssistantSession, text: string): ToolResultBlockParam[] {
  const { awaiting } = session;
  if (awaiting === null) return [];

  const content = awaiting.kind === 'ask'
    ? `The person answered: ${text}`
    : 'The plan was shown to the person.';

  return [{ type: 'tool_result', tool_use_id: awaiting.toolUseId, content }];
}

/**
 * The state worth keeping when a long chat is cut down. All of it is stored
 * outside the messages, so nothing the person said is lost.
 */
function summaryOf(session: AssistantSession): string {
  const answers = Object.entries(session.answers).map(([field, value]) => `${field} = ${value}`);
  const lines = ['(The earlier chat was shortened. This is what is known so far.)'];
  if (session.templateId !== null) lines.push(`Template: ${session.templateId}`);
  if (answers.length > 0) lines.push(`Answers: ${answers.join('; ')}`);
  if (session.plan !== null) {
    const drafts = session.plan.map((item) => ({ planItem: item.number, saved: item.createdId !== undefined, item: item.draft }));
    lines.push(`Plan (${session.state}): ${JSON.stringify(drafts)}`);
  }

  return lines.join('\n');
}

const allSaved = (session: AssistantSession) => session.state === 'accepted'
  && session.plan?.every((item) => item.createdId !== undefined) === true;

export class AssistantService implements IAssistantService {
  private lastHealth: { at: number; available: boolean } | null = null;

  constructor(
    private readonly sessions: IAssistantSessionsRepository,
    private readonly usage: IAssistantUsageRepository,
    private readonly client: IAssistantClient,
    private readonly tools: AssistantToolsService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  templates(): TemplateSummary[] {
    return templateSummaries();
  }

  /**
   * Pings the model once a minute at most. Any failure — expired key, no
   * credit, an outage — reads as "not available"; the reason goes to the log
   * for us, never to the app.
   */
  async health(): Promise<AssistantHealth> {
    const now = this.now().getTime();
    if (this.lastHealth !== null && now - this.lastHealth.at < HEALTH_TTL_MS) {
      return { available: this.lastHealth.available };
    }

    let available = true;
    try {
      await this.client.ping();
    } catch (error) {
      available = false;
      console.error('[assistant] health check failed:', error instanceof Error ? error.message : error);
    }
    this.lastHealth = { at: now, available };

    return { available };
  }

  async start(userId: string, input: StartSession): Promise<AssistantReply> {
    const template = input.templateId === undefined ? undefined : templateById(input.templateId);
    if (input.templateId !== undefined && template === undefined) {
      throw new InputValidationError(`Unknown template "${input.templateId}".`);
    }
    await this.spend(userId);

    const session = this.newSession(userId, template?.id ?? null, input.timezoneOffsetMinutes);
    const opening = [describeNow(this.now(), input.timezoneOffsetMinutes)];
    if (template !== undefined) opening.push(`I want to set up: ${template.title} (template "${template.id}").`);
    if (input.message !== undefined) opening.push(input.message);
    session.messages.push({ role: 'user', content: opening.join('\n\n') });
    await this.sessions.create(session);

    return this.runAndSave(session);
  }

  async send(userId: string, sessionId: string, input: SendMessage): Promise<AssistantReply> {
    const session = await this.load(userId, sessionId);
    await this.spend(userId);

    session.offsetMinutes = input.timezoneOffsetMinutes;
    // Typing instead of tapping Accept means "change it": the shown plan can
    // no longer be accepted, and the model proposes a new one.
    if (session.state === 'proposed') {
      session.state = 'asking';
      session.plan = null;
    }
    this.addPersonTurn(session, input.message);

    return this.runAndSave(session);
  }

  async accept(userId: string, sessionId: string, _input: AcceptPlan): Promise<AssistantReply> {
    const accepted = await this.sessions.accept(sessionId, userId);
    if (!accepted) {
      await this.load(userId, sessionId);
      throw new ConflictError('There is no plan waiting to be accepted.');
    }
    const session = await this.load(userId, sessionId);
    await this.spend(userId);

    const numbers = (session.plan ?? []).map((item) => String(item.number)).join(', ');
    this.addPersonTurn(session, `The person tapped Accept. Create plan items ${numbers} now.`);

    return this.runAndSave(session);
  }

  async close(userId: string, sessionId: string): Promise<void> {
    await this.sessions.delete(sessionId, userId);
  }

  private newSession(userId: string, templateId: string | null, offsetMinutes: number) {
    const now = this.now();
    const session: AssistantSession = {
      id: randomUUID(),
      userId,
      templateId,
      messages: [],
      pendingResults: [],
      awaiting: null,
      answers: {},
      state: 'asking',
      plan: null,
      offsetMinutes,
      createdAt: now,
      expiresAt: new Date(now.getTime() + IDLE_MS),
    };

    return session;
  }

  private async load(userId: string, sessionId: string): Promise<AssistantSession> {
    const session = await this.sessions.get(sessionId, userId);
    // 404 rather than 403 for someone else's session: do not confirm it exists.
    if (session === null) throw new ResourceNotFoundError('This chat has ended. Start a new one.');

    return session;
  }

  private async spend(userId: string): Promise<void> {
    const count = await this.usage.increment(userId, this.now());
    if (count > DAILY_LIMIT) {
      throw new TooManyRequestsError('The assistant has reached today\'s limit. Try again tomorrow.');
    }
  }

  /**
   * Appends what the person said, first paying any tool result still owed.
   *
   * A long chat is not trimmed from the middle — that would break the prompt
   * cache and the model's thinking blocks. It is restarted from a summary
   * built by code from `answers` and `plan`, which live outside the messages.
   */
  private addPersonTurn(session: AssistantSession, text: string): void {
    const { awaiting } = session;
    if (awaiting?.kind === 'ask' && awaiting.field !== undefined) session.answers[awaiting.field] = text;

    if (session.messages.length >= MAX_SESSION_MESSAGES) {
      session.messages = [{ role: 'user', content: `${summaryOf(session)}\n\n${text}` }];
    } else {
      const results = [...session.pendingResults, ...awaitedResult(session, text)];
      const answered = awaiting?.kind === 'ask';
      const content = answered ? results : [...results, { type: 'text' as const, text }];
      session.messages.push({ role: 'user', content });
    }
    session.pendingResults = [];
    session.awaiting = null;
  }

  private async runAndSave(session: AssistantSession): Promise<AssistantReply> {
    session.expiresAt = new Date(this.now().getTime() + IDLE_MS);
    const context: ToolContext = { session, rejections: 0 };
    const end = await this.runTurn(context, 1, { texts: [], pause: null, created: [] });

    const done = allSaved(session);
    if (done) await this.sessions.delete(session.id, session.userId);
    else await this.sessions.save(session);

    return this.replyOf(session, end, done);
  }

  /**
   * One model call, its tools, and another call if the tools did not stop to
   * wait for the person. Recursion rather than a loop: each call depends on
   * the last one's results, and `no-await-in-loop` is right that a loop would
   * read as if they could run together.
   */
  private async runTurn(context: ToolContext, call: number, end: TurnEnd): Promise<TurnEnd> {
    const { session } = context;
    const reply = await this.client.send(session.messages);
    if (reply.stopReason === 'refusal' || reply.stopReason === 'max_tokens') {
      // Not kept: a cut-off tool call would leave the history unanswerable.
      return { ...end, texts: [...end.texts, STOPPED] };
    }

    session.messages.push({ role: 'assistant', content: reply.content });
    const text = textOf(reply.content);
    const said = text === '' ? end.texts : [...end.texts, text];
    const uses = reply.content.filter(isToolUse);
    if (uses.length === 0) return { ...end, texts: said };

    const { pause, created } = await this.runTools(context, uses);
    const next = { texts: said, pause, created: [...end.created, ...created] };
    if (pause !== null || call >= MAX_MODEL_CALLS) return next;

    return this.runTurn(context, call + 1, next);
  }

  /** Runs the calls together; at most one of them may stop for the person. */
  private async runTools(context: ToolContext, uses: ToolUseBlock[]) {
    const outcomes = await Promise.all(uses.map((use) => this.tools.run(use, context)));
    const pauseAt = outcomes.findIndex(isPause);
    const results = outcomes.flatMap((outcome, index) => {
      const use = uses[index];

      return index === pauseAt || use === undefined ? [] : [toResult(use, outcome)];
    });
    const created = outcomes.flatMap((outcome) => (outcome.kind === 'created' ? [outcome.created] : []));

    return { pause: this.holdFor(context.session, uses, outcomes, pauseAt, results), created };
  }

  /** Either waits for the person on one call, or sends every result back now. */
  private holdFor(
    session: AssistantSession,
    uses: ToolUseBlock[],
    outcomes: ToolOutcome[],
    pauseAt: number,
    results: ToolResultBlockParam[],
  ): Pause | null {
    const use = uses[pauseAt];
    const outcome = outcomes[pauseAt];
    if (use === undefined || outcome === undefined || !isPause(outcome)) {
      session.messages.push({ role: 'user', content: results });

      return null;
    }

    session.pendingResults = results;
    session.awaiting = outcome.kind === 'ask'
      ? { toolUseId: use.id, kind: 'ask', field: outcome.ask.field }
      : { toolUseId: use.id, kind: 'plan' };

    return { toolUseId: use.id, outcome };
  }

  private replyOf(session: AssistantSession, end: TurnEnd, done: boolean): AssistantReply {
    const reply: AssistantReply = { sessionId: session.id, text: end.texts.join('\n\n'), done };
    const outcome = end.pause?.outcome;
    if (outcome?.kind === 'ask') reply.ask = outcome.ask satisfies AskControl;
    if (outcome?.kind === 'plan') reply.plan = outcome.text;
    if (end.created.length > 0) reply.created = end.created;

    return reply;
  }
}
