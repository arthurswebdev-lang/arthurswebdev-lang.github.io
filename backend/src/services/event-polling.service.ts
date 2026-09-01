import { isPassedEvent, isEventTask, remindAt } from '../filters/tasks.filters.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import type { INotificationService } from '../interfaces/notification-service.interface.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { EventTask } from '../types/tasks.types.js';

/**
 * Wakes up on an interval and sends the reminders that have come due.
 *
 * "Come due" is a question about the event, not about this process: an event is
 * owed a reminder when `remindAt` has arrived and `notifiedAt` is still null.
 * That is deliberate, and it replaced a window held between passes in memory.
 *
 * The window had two failures that a stored stamp does not. A restart reset it,
 * so anything that came due while the machine was down was never announced —
 * not late, never. And it could not cope with `remindBeforeMins` at all: an
 * occurrence generated *after* its own reminder moment had gone by, which is
 * what a repeat shorter than its lead time produces, had a `remindAt` behind
 * the window's start and so was silently skipped for ever. Asking the event
 * makes both cases resolve themselves on the next pass.
 */
export class EventPollingService {
  private timer: NodeJS.Timeout | null = null;

  private isRunning = false;

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

  /**
   * One pass. Public, and takes the instant to run as of, so a test can drive
   * it at a named moment rather than arranging for the clock to say one.
   */
  async tick(now: Date = new Date()): Promise<void> {
    // A pass slower than the interval must not overlap the next one, or the
    // same event could be announced twice before the first stamp lands.
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Order matters: stamp what has gone by, top the configs back up, then
      // announce. Announcing first would skip an event that came due and was
      // replaced in the same pass.
      await this.taskGenerator.markPassedEvents(now);
      await this.taskGenerator.syncPendingEvents(now);

      await this.announceDue(now);
    } catch (error) {
      // A failed pass must not kill the timer; the next one retries.
      console.error('[event-polling] pass failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stamp first, then send.
   *
   * The stamp is what stops a second pass announcing the same event, so it has
   * to be in place before anything slow happens. Getting this backwards means a
   * send that takes longer than the poll interval is started twice. The cost is
   * that a send failing after the stamp is not retried — the right trade, since
   * a duplicate alert is worse than a missed one, and FCM already retries.
   */
  private async announceDue(now: Date): Promise<void> {
    const due = await this.findDue(now);

    await Promise.all(due.map((event) => this.tasksRepository.markNotified(event.id, now)));
    await Promise.all(due.map((event) => this.notificationService.notify(event)));
  }

  private async findDue(now: Date): Promise<EventTask[]> {
    const tasks = await this.tasksRepository.listAcrossUsers();

    return tasks.filter(isEventTask).filter((event) => (
      event.notifiedAt === null
      && event.status !== TaskStatus.DONE
      && remindAt(event) <= now
      // Its window has already closed, so the alert has nothing to offer. This
      // is the guard against a machine that was down for a day waking up and
      // announcing yesterday's reminders as though they were news.
      && !isPassedEvent(event, now)
    ));
  }
}
