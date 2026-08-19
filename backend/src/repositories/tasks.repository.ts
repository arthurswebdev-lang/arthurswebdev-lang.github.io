import { randomUUID } from 'node:crypto';

import type { Db, Filter } from 'mongodb';

import { TaskCategory } from '../enum/task-category.enum.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import { activeLogicForRepeatedTask } from '../filters/tasks.filters.js';
import type { ITasksRepository, TaskQuery } from '../interfaces/tasks-repository.interface.js';
import { DEFAULT_EVENT_ACTIVE_LOGIC } from '../schemes/common.schemes.js';
import type { CreateTask, EventTask, Subtask, SubtaskDraft, Task, UpdateTask } from '../types/tasks.types.js';
import type { RepeatedTask } from '../types/repeated-tasks.types.js';
import { InputValidationError } from '../utils/http-errors/input-validation.error.js';
import type { Persisted } from './entity.interface.js';
import { MongoRepository } from './mongo.repository.js';

export const TASKS_COLLECTION = 'tasks';

function toSubtasks(drafts: SubtaskDraft[] | undefined): Subtask[] {
  return (drafts ?? []).map((draft) => ({ ...draft, id: randomUUID() }));
}

export class TasksRepository
  extends MongoRepository<Task, CreateTask, UpdateTask>
  implements ITasksRepository {
  constructor(db: Db) {
    super(db, TASKS_COLLECTION);
  }

  /**
   * The two lookups that are not by primary key: the poller scans for events
   * that just came due, and every config change touches its own events.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ configTaskId: 1 });
    await this.collection.createIndex({ category: 1 });
    // Every read is scoped by owner, so it leads every index.
    await this.collection.createIndex({ userId: 1, type: 1 });
    await this.collection.createIndex({ type: 1, date: 1 });
  }

  async listBy(query: TaskQuery): Promise<Task[]> {
    const filter: Record<string, unknown> = { userId: query.userId };
    if (query.category !== undefined) filter['category'] = query.category;
    if (query.type !== undefined) filter['type'] = query.type;
    if (query.status !== undefined) filter['status'] = query.status;
    // Anchored to nothing, so it matches anywhere in the name; `i` for case.
    if (query.search !== undefined) filter['name'] = { $regex: query.search, $options: 'i' };

    const documents = await this.collection.find(filter as Filter<Persisted<Task>>).toArray();

    return documents.map((document) => this.toDomain(document));
  }

  /**
   * The single place an event is built from a config, so a first generation and
   * a regeneration after an edit cannot drift apart (B5). The config owns the
   * name and the active logic; the occurrence owns the date.
   */
  async createGeneratedEvent(config: RepeatedTask, date: Date): Promise<EventTask> {
    const event: EventTask = {
      id: randomUUID(),
      // The occurrence belongs to whoever owns the config that made it.
      userId: config.userId,
      type: TaskType.EVENT,
      status: TaskStatus.TODO,
      name: config.name,
      createdAt: new Date(),
      // Inherited: a generated event cannot be edited, so whatever it needs to
      // be useful has to come from the config.
      category: config.category,
      links: [...config.links],
      subtasks: [],
      date,
      activeLogic: activeLogicForRepeatedTask(config),
      passedDate: null,
      configTaskId: config.id,
    };

    await this.collection.insertOne(this.toDocument(event));

    return event;
  }

  async deleteManyByIds(ids: string[], userId: string): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await this.collection.deleteMany({ _id: { $in: ids }, userId });

    return result.deletedCount;
  }

  async deleteEventsOfConfig(configTaskId: string): Promise<number> {
    const result = await this.collection.deleteMany({ type: TaskType.EVENT, configTaskId });

    return result.deletedCount;
  }

  /**
   * A single-field write, not a read-modify-replace: status is the one thing a
   * generated event may change, and PATCH must not disturb anything else.
   */
  async updateStatus(id: string, status: TaskStatus): Promise<Task | null> {
    const updated = await this.collection.findOneAndUpdate(
      this.byId(id),
      { $set: { status } },
      { returnDocument: 'after' },
    );

    return updated === null ? null : this.toDomain(updated);
  }

  /**
   * A positional update, so only the one subtask's status is written: reading
   * the task, editing the array and writing it back would clobber a change
   * made in between, and would regenerate nothing else by accident.
   */
  async updateSubtaskStatus(
    taskId: string,
    subtaskId: string,
    status: TaskStatus.DONE | TaskStatus.TODO,
  ): Promise<Task | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: taskId, 'subtasks.id': subtaskId },
      { $set: { 'subtasks.$.status': status } },
      { returnDocument: 'after' },
    );

    return updated === null ? null : this.toDomain(updated);
  }

  async markEventPassed(eventId: string, passedAt: Date): Promise<EventTask | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: eventId, type: TaskType.EVENT },
      { $set: { passedDate: passedAt } },
      { returnDocument: 'after' },
    );

    return updated === null ? null : this.toDomain(updated) as EventTask;
  }

  /** Unscoped on purpose; see the interface. */
  async listAcrossUsers(): Promise<Task[]> {
    const documents = await this.collection.find().toArray();

    return documents.map((document) => this.toDomain(document));
  }

  protected toEntity(input: CreateTask, userId: string): Task {
    const base = {
      id: randomUUID(),
      userId,
      createdAt: new Date(),
      status: input.status ?? TaskStatus.TODO,
      category: input.category ?? TaskCategory.OTHER,
      links: input.links ?? [],
    };

    switch (input.type) {
      case TaskType.BASIC:
        return { ...input, ...base, subtasks: toSubtasks(input.subtasks) };
      case TaskType.EVENT:
        return {
          ...input,
          ...base,
          subtasks: toSubtasks(input.subtasks),
          date: new Date(input.date),
          activeLogic: input.activeLogic ?? DEFAULT_EVENT_ACTIVE_LOGIC,
          // Server-owned. The poller stamps passedDate; the generator is the
          // only thing that ever sets configTaskId.
          passedDate: null,
          configTaskId: null,
        };
    }
  }

  /**
   * PUT semantics: the stored task is replaced by the payload outright, so a
   * field the client omits reverts to its default rather than keeping its
   * previous value.
   */
  protected applyUpdate(entity: Task, changes: UpdateTask): Task {
    if (changes.type !== entity.type) {
      throw new InputValidationError(
        `A task cannot change type (${entity.type} -> ${changes.type})`,
      );
    }

    const replacement = this.toEntity(changes, entity.userId);
    const identity = { id: entity.id, userId: entity.userId, createdAt: entity.createdAt };

    // Server-owned event fields have to survive a replacement too. They are
    // absent from the payload by design, so taking them from the rebuilt task
    // would reset them: a generated event would lose the link to its config,
    // and a passed one would look pending again.
    if (entity.type === TaskType.EVENT && replacement.type === TaskType.EVENT) {
      return {
        ...replacement,
        ...identity,
        configTaskId: entity.configTaskId,
        passedDate: entity.passedDate,
      };
    }

    return { ...replacement, ...identity };
  }
}
