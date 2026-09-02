import type {
  IRepeatedTasksRepository,
} from '../interfaces/repeated-tasks-repository.interface.js';
import type { IRepeatedTasksService } from '../interfaces/repeated-tasks-service.interface.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import { TaskType } from '../enum/task-type.enum.js';
import { scheduleMoved } from '../rules/repeated-task-schedule.rules.js';
import { UpdateRepeatedTaskSchema } from '../schemes/repeated-tasks.schemes.js';
import { validate } from '../middlewares/validation/util/validation.util.js';
import type {
  CreateRepeatedTask, PatchRepeatedTask, RepeatedSubtaskDraft, RepeatedTask, UpdateRepeatedTask,
} from '../types/repeated-tasks.types.js';
import { ResourceNotFoundError } from '../utils/http-errors/resource-not-found.error.js';

/**
 * A stored config back down to the payload that would recreate it. Step ids are
 * dropped because the server assigns them, and the schema refuses keys it does
 * not own — so a merged patch has to look like something a client would send.
 */
/**
 * `'link' in step` and not a comparison against undefined: with
 * exactOptionalPropertyTypes the key is absent or a string, never both.
 */
const stepDrafts = (config: RepeatedTask): RepeatedSubtaskDraft[] => config.subtasks.map(
  (step) => ('link' in step ? { name: step.name, link: step.link } : { name: step.name }),
);

/** Everything a config carries whatever its schedule. */
const sharedDraft = (config: RepeatedTask) => ({
  name: config.name,
  category: config.category,
  links: [...config.links],
  remindBeforeMins: config.remindBeforeMins,
  activeBeforeMins: config.activeBeforeMins,
  activeForMins: config.activeForMins,
  subtasks: stepDrafts(config),
});

function asDraft(config: RepeatedTask): UpdateRepeatedTask {
  const shared = sharedDraft(config);

  switch (config.type) {
    case TaskType.REPEATED_DAILY:
      return {
        ...shared,
        type: config.type,
        startsAt: config.startsAt,
        endsAt: config.endsAt,
        repeatEach: config.repeatEach,
      };
    case TaskType.REPEATED_WEEKLY:
      return { ...shared, type: config.type, weekdays: [...config.weekdays] };
    case TaskType.REPEATED_MONTHLY:
      return { ...shared, type: config.type, fromDay: config.fromDay, months: [...config.months] };
  }
}

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

  listAll(userId: string): Promise<RepeatedTask[]> {
    return this.repeatedTasksRepository.list(userId);
  }

  /** Another owner's id reads as missing, same as for tasks. */
  async getById(id: string, userId: string): Promise<RepeatedTask | null> {
    const config = await this.repeatedTasksRepository.getById(id);

    return config?.userId === userId ? config : null;
  }

  private async ownedOrMissing(id: string, userId: string): Promise<RepeatedTask> {
    const config = await this.getById(id, userId);
    if (config === null) throw new ResourceNotFoundError(`No repeated task with id ${id}.`);

    return config;
  }

  async create(input: CreateRepeatedTask, userId: string): Promise<RepeatedTask> {
    const config = await this.repeatedTasksRepository.create(input, userId);

    // Generate straight away rather than leaving the config with nothing
    // pending until the next poll.
    await this.taskGenerator.ensurePendingEvent(config, new Date());

    return config;
  }

  async updateById(id: string, userId: string, changes: UpdateRepeatedTask): Promise<RepeatedTask> {
    const before = await this.ownedOrMissing(id, userId);

    const updated = await this.repeatedTasksRepository.updateById(id, changes);
    if (updated === null) throw new ResourceNotFoundError(`No repeated task with id ${id}.`);

    await this.reconcileEvents(before, updated);

    return updated;
  }

  /**
   * PATCH: the fields named, and only those. The stored config supplies the
   * rest, and the merged result goes through the same schema a PUT would, so a
   * patch cannot assemble a config a create would have refused — `weekdays` on
   * a daily config, or a reminder that arrives before the task is visible.
   */
  async patchById(id: string, userId: string, changes: PatchRepeatedTask): Promise<RepeatedTask> {
    const before = await this.ownedOrMissing(id, userId);
    const merged = { ...asDraft(before), ...changes };

    validate(UpdateRepeatedTaskSchema, merged);

    // Validated as a whole config on the line above. The compiler cannot see
    // that through the spread, which widens `type` back out of its literal.
    const payload = merged as UpdateRepeatedTask;
    const updated = await this.repeatedTasksRepository.updateById(id, payload);
    if (updated === null) throw new ResourceNotFoundError(`No repeated task with id ${id}.`);

    await this.reconcileEvents(before, updated);

    return updated;
  }

  /**
   * What an edit means for the occurrences already waiting.
   *
   * Only a change to the *schedule* invalidates a date, and only a date needs
   * an occurrence remade. Everything else a generated event carries — its name,
   * category, links, window and steps — can be written straight onto the
   * occurrences that are still waiting, which is how fixing a typo stopped
   * costing you the sessions you had already done.
   */
  private async reconcileEvents(before: RepeatedTask, after: RepeatedTask): Promise<void> {
    const now = new Date();

    if (scheduleMoved(before, after)) {
      await this.taskGenerator.regenerateForConfig(after, now);

      return;
    }

    await this.taskGenerator.refreshEventsOfConfig(after, now);
  }

  async deleteById(id: string, userId: string): Promise<void> {
    await this.ownedOrMissing(id, userId);

    // Events first, config second. The two stores cannot be written atomically,
    // and this order fails safe: a crash in between leaves a config whose
    // events the next poll simply regenerates. The other order would strand
    // events pointing at a config that no longer exists.
    await this.tasksRepository.deleteEventsOfConfig(id);

    const deleted = await this.repeatedTasksRepository.deleteById(id);
    if (!deleted) throw new ResourceNotFoundError(`No repeated task with id ${id}.`);
  }
}
