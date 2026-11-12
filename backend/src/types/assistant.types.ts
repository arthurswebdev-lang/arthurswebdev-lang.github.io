import type Anthropic from '@anthropic-ai/sdk';

import type { TaskType } from '../enum/task-type.enum.js';
import type { CreateRepeatedTask } from './repeated-tasks.types.js';
import type { CreateTask } from './tasks.types.js';

export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type ContentBlock = Anthropic.Beta.BetaContentBlock;
export type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
export type ToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;

/** Which control the app shows for an answer. */
export type AnswerInput = 'text' | 'time' | 'date' | 'url' | 'choice' | 'list';

export interface PlanStep {
  name: string;
  link?: string;
}

/** "Every 2h from 09:00 to 21:00", expanded by the server, never by the model. */
export interface TimeGrid {
  from: string;
  until: string;
  every: string;
}

/**
 * One thing to create, as the model drafts it: **local** clock times and a
 * local date, never UTC. The server converts (`plan-payload.util.ts`), which is
 * where the timezone arithmetic is tested.
 */
export interface PlanDraft {
  kind: TaskType;
  name: string;
  category?: string;
  links?: string[];
  photoUrl?: string;
  steps?: PlanStep[];
  /** EVENT only: `YYYY-MM-DDTHH:mm` on the person's clock. */
  date?: string;
  /** Repeats: `HH:mm` on the person's clock. */
  times?: string[];
  timeGrid?: TimeGrid;
  weekdays?: number[];
  dayOfMonth?: number;
  months?: number[];
  remindBeforeMins?: number;
  activeBeforeMins?: number;
  activeForMins?: number;
}

export type CreatePayload = CreateTask | CreateRepeatedTask;

/** A drafted item after conversion and validation: exactly what Accept writes. */
export interface PlanItem {
  number: number;
  draft: PlanDraft;
  payload: CreatePayload;
  /** Set once the create tool call for this item has succeeded. */
  createdId?: string;
}

/**
 * Where a session is. `proposed` is the only state Accept works from, and the
 * create tools work only once it is `accepted` — that is the whole guard.
 */
export type SessionState = 'asking' | 'proposed' | 'accepted';

/** The tool call the person is about to answer, whose result is still owed. */
export interface Awaiting {
  toolUseId: string;
  kind: 'ask' | 'plan';
  field?: string;
}

export interface AssistantSession {
  id: string;
  userId: string;
  templateId: string | null;
  messages: MessageParam[];
  /** Results of tools that ran beside the call being waited on. */
  pendingResults: ToolResultBlockParam[];
  awaiting: Awaiting | null;
  /** field -> answer. Survives compaction, which is why it is kept apart. */
  answers: Record<string, string>;
  state: SessionState;
  plan: PlanItem[] | null;
  /** `Date#getTimezoneOffset()` of the device: minutes to add to local for UTC. */
  offsetMinutes: number;
  createdAt: Date;
  /** Mongo's TTL index deletes the session after this. Moved on every message. */
  expiresAt: Date;
}

export interface AskControl {
  field: string;
  question: string;
  input: AnswerInput;
  options?: string[];
}

export interface CreatedItem {
  resource: 'task' | 'repeated-task';
  id: string;
  name: string;
}

/** One answer from the assistant, in the one shape the app draws. */
export interface AssistantReply {
  sessionId: string;
  text: string;
  ask?: AskControl;
  /** The compact plan, rendered by code from the validated items. */
  plan?: string;
  created?: CreatedItem[];
  /** True once the session is over and deleted. */
  done: boolean;
}

/** What the app needs to know before it opens a chat — and nothing about why. */
export interface AssistantHealth {
  available: boolean;
}

export interface TemplateSummary {
  id: string;
  title: string;
}

export interface StartSession {
  templateId?: string;
  message?: string;
  timezoneOffsetMinutes: number;
}

export interface SendMessage {
  message: string;
  timezoneOffsetMinutes: number;
}

export interface AcceptPlan {
  timezoneOffsetMinutes: number;
}

/** Route params for `/assistant/sessions/:id`. An alias, as Express requires. */
export type SessionIdParams = Record<'id', string>;
