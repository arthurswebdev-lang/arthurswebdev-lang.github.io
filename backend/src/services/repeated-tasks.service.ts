import type {
  IRepeatedTasksRepository,
} from '../interfaces/repeated-tasks-repository.interface.js';
import type { IRepeatedTasksService } from '../interfaces/repeated-tasks-service.interface.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { CreateRepeatedTask, RepeatedTask, UpdateRepeatedTask } from '../types/repeated-tasks.types.js';
import { ResourceNotFoundError } from '../utils/http-errors/resource-not-found.error.js';

/**
 * CRUD for the configs, plus the generation each change implies. The config
 * itself lives in one store and the events it produced in another, so every
 * write here touches both — see the ordering note on `deleteById`.
 */
export class RepeatedTasksService implements IRepeatedTasksService {
  constructor(
    private readonly repeatedTasksRepository: IRepeatedTasksRepository,
    private readonly tasksRepository: ITasksRepository,
    private readonly taskGenerator: ITaskGeneratorService,
  ) {}

  listAll(): Promise<RepeatedTask[]> {
    return this.repeatedTasksRepository.list();
  }

  getById(id: string): Promise<RepeatedTask | null> {
    return this.repeatedTasksRepository.getById(id);
  }

  async create(input: CreateRepeatedTask): Promise<RepeatedTask> {
    const config = await this.repeatedTasksRepository.create(input);

    // Generate straight away rather than leaving the config with nothing
    // pending until the next poll.
    await this.taskGenerator.ensurePendingEvent(config, new Date());

    return config;
  }

  async updateById(id: string, changes: UpdateRepeatedTask): Promise<RepeatedTask> {
    const updated = await this.repeatedTasksRepository.updateById(id, changes);
    if (updated === null) throw new ResourceNotFoundError(`No repeated task with id ${id}.`);

    // The schedule may have changed, so the events it produced no longer follow
    // from it: wipe them and start again (B5).
    await this.taskGenerator.regenerateForConfig(updated, new Date());

    return updated;
  }

  async deleteById(id: string): Promise<void> {
    // Events first, config second. The two stores cannot be written atomically,
    // and this order fails safe: a crash in between leaves a config whose
    // events the next poll simply regenerates. The other order would strand
    // events pointing at a config that no longer exists.
    await this.tasksRepository.deleteEventsOfConfig(id);

    const deleted = await this.repeatedTasksRepository.deleteById(id);
    if (!deleted) throw new ResourceNotFoundError(`No repeated task with id ${id}.`);
  }
}
