import { TaskStatus } from '../enum/task-status.enum.js';
import { filterTasks, isEventTask } from '../filters/tasks.filters.js';
import { sortTasks } from '../filters/tasks.sort.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type {
  IRepeatedTasksRepository,
} from '../interfaces/repeated-tasks-repository.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { ITasksService, ListTasksQuery } from '../interfaces/tasks-service.interface.js';
import type {
  CreateTask, Task, TaskWithConfig, UpdateTask,
} from '../types/tasks.types.js';
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
    private readonly repeatedTasksRepository: IRepeatedTasksRepository,
    private readonly taskGenerator: ITaskGeneratorService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Attaches each generated event's config, in one extra query for the whole
   * list rather than one request per event from the client.
   */
  private async withConfigs(tasks: Task[]): Promise<TaskWithConfig[]> {
    const ids = [...new Set(
      tasks.filter(isEventTask).map((event) => event.configTaskId).filter((id) => id !== null),
    )];
    if (ids.length === 0) return tasks;

    const configs = new Map(
      (await this.repeatedTasksRepository.listByIds(ids)).map((config) => [config.id, config]),
    );

    return tasks.map((task) => {
      if (!isEventTask(task) || task.configTaskId === null) return task;

      const config = configs.get(task.configTaskId);

      return config === undefined ? task : { ...task, config };
    });
  }

  /**
   * Filtering happens here rather than in the query: `actual` and `upcoming`
   * depend on each event's own `activeLogic` window, which is a rule set worth
   * reading (`src/filters/tasks.filters.ts`) rather than an aggregation
   * pipeline. `passed` alone could move into Mongo if the collection ever grows
   * enough to care.
   */
  async listAll({ userId, filter, category }: ListTasksQuery): Promise<TaskWithConfig[]> {
    // Category is plain equality, so the database does it; the time filter is
    // the rule set in tasks.filters.ts and stays here where it can be read.
    const tasks = category === undefined
      ? await this.tasksRepository.list(userId)
      : await this.tasksRepository.listBy({ userId, category });

    return this.withConfigs(sortTasks(filterTasks(tasks, filter, this.now())));
  }

  /**
   * Someone else's id reads as missing rather than forbidden: a 403 would
   * confirm the task exists, which is more than a caller should learn.
   */
  async getById(id: string, userId: string): Promise<TaskWithConfig | null> {
    const task = await this.tasksRepository.getById(id);
    if (task?.userId !== userId) return null;

    const [joined] = await this.withConfigs([task]);

    return joined ?? task;
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

  /**
   * Steps move on a generated event too: the config owns the name, date and
   * schedule, but whether a step is done is the user's, same as the task's own
   * status.
   */
  async updateSubtaskStatus(
    taskId: string,
    userId: string,
    subtaskId: string,
    status: TaskStatus.DONE | TaskStatus.TODO,
  ): Promise<Task> {
    await this.ownedOrMissing(taskId, userId);

    const updated = await this.tasksRepository.updateSubtaskStatus(taskId, subtaskId, status);
    if (updated === null) throw new ResourceNotFoundError(`No step with id ${subtaskId}.`);

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

  clear(ids: string[], userId: string): Promise<number> {
    // No ownership pre-check: the delete itself is scoped by owner, so an id
    // that is not yours simply does not match. Reporting which ids failed
    // would tell a caller whose they are.
    return this.tasksRepository.deleteManyByIds(ids, userId);
  }

  async deleteById(id: string, userId: string): Promise<void> {
    const task = await this.ownedOrMissing(id, userId);

    // A generated event is one occurrence of a rule. Deleting it alone would be
    // undone by the next poll, so deleting it means deleting the rule — and
    // with it every event that rule produced.
    if (isEventTask(task) && task.configTaskId !== null) {
      await this.tasksRepository.deleteEventsOfConfig(task.configTaskId);
      await this.repeatedTasksRepository.deleteById(task.configTaskId);

      return;
    }

    const deleted = await this.tasksRepository.deleteById(id);
    if (!deleted) throw new ResourceNotFoundError(`No task with id ${id}.`);
  }
}
