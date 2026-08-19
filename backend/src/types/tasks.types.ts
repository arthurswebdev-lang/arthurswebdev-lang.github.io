import type { ActiveLogic } from '../enum/active-logic.enum.js';
import type { TaskStatus } from '../enum/task-status.enum.js';
import type { TaskType } from '../enum/task-type.enum.js';

export interface Subtask {
  id: string;
  name: string;
  // A subtask is atomic, so it is never PARTIALLY_DONE.
  status: TaskStatus.DONE | TaskStatus.TODO;
}

/** Fields every task carries, whatever its type. Not a task on its own. */
export interface BaseTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  name: string;
  createdAt: Date;
}

export interface BasicTask extends BaseTask {
  type: TaskType.BASIC;
  subtasks: Subtask[];
}

export interface EventTask extends BaseTask {
  type: TaskType.EVENT;
  subtasks: Subtask[];
  date: Date;
  activeLogic: ActiveLogic;
  /** Set once the event's date is in the past; `null` while it is still ahead. */
  passedDate: Date | null;
  /** The repeated task that generated this event; `null` if a client made it. */
  configTaskId: string | null;
}

/**
 * What the user actually works with, discriminated on `type`. Configs are
 * deliberately *not* in this union: they are a different resource in a
 * different file, and every config is represented in this list anyway by the
 * event it currently has pending.
 */
export type Task = BasicTask | EventTask;

/** A subtask as the client sends it: the server assigns the id. */
export type SubtaskDraft = Omit<Subtask, 'id'>;

/**
 * Route params for the `/tasks/:id` endpoints.
 *
 * Deliberately a type alias, not an interface: Express matches handler params
 * against its `ParamsDictionary` (a string index signature), and only aliases
 * get the implicit index signature that makes them assignable to it.
 */
export type TaskIdParams = Record<'id', string>;

/**
 * A task as the client sends it. `id` and `createdAt` belong to the server,
 * and `status` defaults to TODO, so none of the three are required.
 */
export type Draft<T extends BaseTask> = Omit<T, 'id' | 'createdAt' | 'status'> & {
  status?: TaskStatus;
};

type WithSubtaskDrafts<T extends BaseTask & { subtasks: Subtask[] }> =
  Omit<Draft<T>, 'subtasks'> & { subtasks?: SubtaskDraft[] };

/**
 * Event fields the server owns outright: a client never sends them. `passedDate`
 * starts null and is stamped by the poller; `configTaskId` is set only by the
 * generator that created the event from a repeated config.
 */
type ServerOwnedEventFields = 'passedDate' | 'configTaskId';

export type CreateBasicTask = WithSubtaskDrafts<BasicTask>;

/** `activeLogic` is optional on create — see `DEFAULT_EVENT_ACTIVE_LOGIC`. */
export type CreateEventTask =
  Omit<WithSubtaskDrafts<EventTask>, ServerOwnedEventFields | 'activeLogic'>
  & { activeLogic?: ActiveLogic };

/** Payload for `POST /tasks`. */
export type CreateTask = CreateBasicTask | CreateEventTask;

/**
 * PUT replaces the whole task, so an update payload is the same full
 * representation as a create: every field the client wants the task to end up
 * with, minus `id` and `createdAt`, which stay with the server. A field left
 * out is not "unchanged" — it falls back to its default, exactly as on create.
 *
 * A distinct name because the two are the same shape today, not by necessity.
 */
export type UpdateTask = CreateTask;

