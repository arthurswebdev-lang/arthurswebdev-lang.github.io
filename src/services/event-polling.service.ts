import { TaskStatus } from '../enum/task-status.enum.js';
import { TaskType } from '../enum/task-type.enum.js';
import type { INotificationService } from '../interfaces/notification-service.interface.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { EventTask } from '../types/tasks.types.js';

/**
 * Wakes up on an interval and notifies about event tasks that just came due.
 *
 * "Just came due" means the task's date falls in the window between the last
 * pass and this one, which is what keeps a task from being announced on every
 * pass. The window lives in memory, so a restart resets it: events that came
 * due while the process was down are not announced. Persisting a `notifiedAt`
 * on the task is the durable fix when that matters.
 */
export class EventPollingService {
  private timer: NodeJS.Timeout | null = null;

  private isRunning = false;

  private lastCheckedAt = new Date();

  constructor(
    private readonly tasksRepository: ITasksRepository,
    private readonly notificationService: INotificationService,
    private readonly taskGenerator: ITaskGeneratorService,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer !== null) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer === null) return;

    clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public so it can be driven directly in tests. */
  async tick(): Promise<void> {
    // A pass slower than the interval must not overlap the next one, or the
    // same task would be announced twice from the same window.
    if (this.isRunning) return;
    this.isRunning = true;

    const checkedAt = new Date();

    try {
      // Order matters: stamp what has gone by, top the configs back up, then
      // announce. Announcing first would skip an event that came due and was
      // replaced in the same pass.
      await this.taskGenerator.markPassedEvents(checkedAt);
      await this.taskGenerator.syncPendingEvents(checkedAt);

      const due = await this.findDue(checkedAt);
      await Promise.all(due.map((task) => this.notificationService.notify(task)));

      this.lastCheckedAt = checkedAt;
    } catch (error) {
      // A failed pass must not kill the timer; the next one retries.
      console.error('[event-polling] pass failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async findDue(now: Date): Promise<EventTask[]> {
    const tasks = await this.tasksRepository.list();

    return tasks.filter((task): task is EventTask => (
      task.type === TaskType.EVENT
      && task.status !== TaskStatus.DONE
      && task.date > this.lastCheckedAt
      && task.date <= now
    ));
  }
}
