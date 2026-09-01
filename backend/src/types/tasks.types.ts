import type { TaskCategory } from '../enum/task-category.enum.js';
import type { TaskStatus } from '../enum/task-status.enum.js';
import type { TaskType } from '../enum/task-type.enum.js';
import type { RepeatedTask } from './repeated-tasks.types.js';

export interface Subtask {
  id: string;
  name: string;
  // A subtask is atomic, so it is never PARTIALLY_DONE.
  status: TaskStatus.DONE | TaskStatus.TODO;
  /** One reference for this step — the page to read, the form to fill in. */
  link?: string;
}

/**
 * The three durations that say *when* a dated task matters, all in minutes and
 * all measured from the task's own date.
 *
 * For an interview on Friday at 15:00 with 10 / 60 / 180:
 *
 * ```
 *        14:00            14:50   15:00                    18:00
 *   ───────┬────────────────┬───────┬────────────────────────┬──────
 *   upcoming│    actual     │ ping  │        actual          │ passed
 *          └ activeBefore   └ remind└ date                   └ activeFor
 * ```
 *
 * They replaced `ActiveLogic` — TODAY, THIS_WEEK and NEXT_10_DAYS, three
 * calendar windows chosen from the task's *type* rather than from the task.
 * A generated event inherits all three from its config, for the same reason it
 * inherits category and links: it cannot be edited.
 */
export interface TaskWindow {
  /**
   * How long before `date` the reminder is sent. Zero means "on the moment".
   * Never longer than `activeBeforeMins`, or the alert would arrive while the
   * task is still hidden under upcoming.
   */
  remindBeforeMins: number;
  /** How long before `date` it starts showing as actual rather than upcoming. */
  activeBeforeMins: number;
  /**
   * How long after `date` it stays worth acting on. Keeps a reminder in the
   * list for a while instead of filing it under "missed" the moment it is
   * announced.
   */
  activeForMins: number;
}

/** Fields every task carries, whatever its type. Not a task on its own. */
export interface BaseTask {
  id: string;
  /** Owner. Set from the credentials, never from the payload. */
  userId: string;
  type: TaskType;
  status: TaskStatus;
  name: string;
  createdAt: Date;
  /** Fixed set; `OTHER` when the client did not pick one. */
  category: TaskCategory;
  /**
   * Everything you need open to do this task: the lesson and its exercises,
   * the call to join. Always present, empty when there is nothing to open.
   */
  links: string[];
}

export interface BasicTask extends BaseTask {
  type: TaskType.BASIC;
  subtasks: Subtask[];
}

export interface EventTask extends BaseTask, TaskWindow {
  type: TaskType.EVENT;
  subtasks: Subtask[];
  date: Date;
  /** Set once the event's date is in the past; `null` while it is still ahead. */
  passedDate: Date | null;
  /**
   * When this event's reminder was actually sent; `null` until it is.
   *
   * Stored rather than remembered, because the reminder is now a single moment
   * rather than "whenever the date goes by": the poller used to hold an
   * in-memory window, so a restart meant a ping was skipped and never sent at
   * all. A stored stamp also makes the poller idempotent — it asks whether this
   * event has been announced, not whether it came due during this process's
   * lifetime.
   */
  notifiedAt: Date | null;
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

/**
 * What the API hands back for a generated event: the task plus the config that
 * produces it, so a client can edit the repeat without a second request.
 *
 * Deliberately separate from `Task`: this is a view, and writing it back into
 * the tasks collection would store a copy of the config that nothing keeps in
 * step.
 */
export type TaskWithConfig = Task & { config?: RepeatedTask };

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
export type Draft<T extends BaseTask> =
  Omit<T, 'id' | 'userId' | 'createdAt' | 'status' | 'category' | 'links'> & {
    status?: TaskStatus;
    category?: TaskCategory;
    links?: string[];
  };

type WithSubtaskDrafts<T extends BaseTask & { subtasks: Subtask[] }> =
  Omit<Draft<T>, 'subtasks'> & { subtasks?: SubtaskDraft[] };

/**
 * Event fields the server owns outright: a client never sends them. `passedDate`
 * starts null and is stamped by the poller; `configTaskId` is set only by the
 * generator that created the event from a repeated config.
 */
type ServerOwnedEventFields = 'passedDate' | 'configTaskId' | 'notifiedAt';

export type CreateBasicTask = WithSubtaskDrafts<BasicTask>;

/** The three windows are optional on create; see `DEFAULT_EVENT_WINDOW`. */
export type CreateEventTask =
  Omit<
    WithSubtaskDrafts<EventTask>,
    ServerOwnedEventFields | 'remindBeforeMins' | 'activeBeforeMins' | 'activeForMins'
  >
  & { remindBeforeMins?: number; activeBeforeMins?: number; activeForMins?: number };

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

