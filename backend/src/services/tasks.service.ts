import { TaskStatus } from '../enum/task-status.enum.js';
import { filterTasks, isEventTask } from '../filters/tasks.filters.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { ITasksService, ListTasksQuery } from '../interfaces/tasks-service.interface.js';
import type { CreateTask, Task, UpdateTask } from '../types/tasks.types.js';
import { assertTaskReplaceAllowed } from '../rules/task-update.rules.js';
import { ResourceNotFoundError } from '../utils/http-errors/resource-not-found.error.js';

export class TasksService implements ITasksService {
  /**
   * `now` is injected for the same reason the filter rules take it as an
   * argument: "what counts as actual" is a question about a particular
   * instant, and a service that reads the clock internally cannot be checked
   * against one.
   */
  constructor(
    private readonly tasksRepository: ITasksRepository,
    private readonly taskGenerator: ITaskGeneratorService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Filtering happens here rather than in the query: `actual` and `upcoming`
   * depend on each event's own `activeLogic` window, which is a rule set worth
   * reading (`src/filters/tasks.filters.ts`) rather than an aggregation
   * pipeline. `passed` alone could move into Mongo if the collection ever grows
   * enough to care.
   */
  async listAll({ userId, filter, category }: ListTasksQuery): Promise<Task[]> {
    // Category is plain equality, so the database does it; the time filter is
    // the rule set in tasks.filters.ts and stays here where it can be read.
    const tasks = category === undefined
      ? await this.tasksRepository.list(userId)
      : await this.tasksRepository.listBy({ userId, category });

    return filterTasks(tasks, filter, this.now());
  }

  /**
   * Someone else's id reads as missing rather than forbidden: a 403 would
   * confirm the task exists, which is more than a caller should learn.
   */
  async getById(id: string, userId: string): Promise<Task | null> {
    const task = await this.tasksRepository.getById(id);

    return task?.userId === userId ? task : null;
  }

  private async ownedOrMissing(id: string, userId: string): Promise<Task> {
    const task = await this.getById(id, userId);
    if (task === null) throw new ResourceNotFoundError(`No task with id ${id}.`);

    return task;
  }

  create(input: CreateTask, userId: string): Promise<Task> {
    return this.tasksRepository.create(input, userId);
  }

  /**
   * The only way to move a generated event. Finishing one early still brings
   * its successor forward, exactly as a full replacement used to.
   */
  async updateStatus(id: string, userId: string, status: TaskStatus): Promise<Task> {
    await this.ownedOrMissing(id, userId);

    const updated = await this.tasksRepository.updateStatus(id, status);
    if (updated === null) throw new ResourceNotFoundError(`No task with id ${id}.`);

    await this.afterUpdate(updated);

    return updated;
  }

  async updateById(id: string, userId: string, changes: UpdateTask): Promise<Task> {
    // Read before writing: what a client may change depends on what is stored —
    // a generated event takes status changes only.
    const current = await this.ownedOrMissing(id, userId);

    assertTaskReplaceAllowed(current);

    const updated = await this.tasksRepository.updateById(id, changes);
    if (updated === null) throw new ResourceNotFoundError(`No task with id ${id}.`);

    await this.afterUpdate(updated);

    return updated;
  }

  /** Finishing a generated event early brings its successor forward (B3). */
  private async afterUpdate(updated: Task): Promise<void> {
    if (isEventTask(updated) && updated.status === TaskStatus.DONE) {
      await this.taskGenerator.generateNextAfter(updated, this.now());
    }
  }

  async deleteById(id: string, userId: string): Promise<void> {
    await this.ownedOrMissing(id, userId);

    const deleted = await this.tasksRepository.deleteById(id);
    if (!deleted) throw new ResourceNotFoundError(`No task with id ${id}.`);
  }
}
