import type { TaskFilter } from '../enum/task-filter.enum.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import { filterTasks, isEventTask } from '../filters/tasks.filters.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { ITasksService } from '../interfaces/tasks-service.interface.js';
import type { CreateTask, Task, UpdateTask } from '../types/tasks.types.js';
import { assertTaskUpdateAllowed } from '../rules/task-update.rules.js';
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
  async listAll(filter?: TaskFilter): Promise<Task[]> {
    const tasks = await this.tasksRepository.list();

    return filterTasks(tasks, filter, this.now());
  }

  getById(id: string): Promise<Task | null> {
    return this.tasksRepository.getById(id);
  }

  create(input: CreateTask): Promise<Task> {
    return this.tasksRepository.create(input);
  }

  async updateById(id: string, changes: UpdateTask): Promise<Task> {
    // Read before writing: what a client may change depends on what is stored —
    // a generated event takes status changes only.
    const current = await this.tasksRepository.getById(id);
    if (current === null) throw new ResourceNotFoundError(`No task with id ${id}.`);

    assertTaskUpdateAllowed(current, changes);

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

  async deleteById(id: string): Promise<void> {
    const deleted = await this.tasksRepository.deleteById(id);
    if (!deleted) throw new ResourceNotFoundError(`No task with id ${id}.`);
  }
}
