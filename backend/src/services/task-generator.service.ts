import {
  activeUntilFor, eventsOfConfig, hasDatePassed, isEventTask, isPassedEvent,
  isRewritableEvent, isUnstartedEvent, pendingEventOfConfig,
} from '../filters/tasks.filters.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import { lastOccurrence, nextOccurrence } from '../generators/occurrences.generator.js';
import type {
  IRepeatedTasksRepository,
} from '../interfaces/repeated-tasks-repository.interface.js';
import type { ITaskGeneratorService } from '../interfaces/task-generator.interface.js';
import type { ITasksRepository } from '../interfaces/tasks-repository.interface.js';
import type { EventTask, Task } from '../types/tasks.types.js';
import type { RepeatedTask } from '../types/repeated-tasks.types.js';

/** Is this config's occurrence for that exact moment already in the list? */
function hasEventOn(tasks: Task[], configTaskId: string, date: Date): boolean {
  return eventsOfConfig(tasks, configTaskId)
    .some((event) => event.date.getTime() === date.getTime());
}

/**
 * The occurrence that has already started and has not run out yet, if there is
 * one: the most recent one at or before `now`, kept only while the window the
 * config asks for is still open.
 */
function occurrenceUnderway(config: RepeatedTask, now: Date): Date | null {
  const last = lastOccurrence(config, now);
  if (last === null) return null;

  return activeUntilFor(last, config) >= now ? last : null;
}

/**
 * Keeps the stored tasks in step with what the configs imply: every config has
 * one event waiting on it, and events whose moment has gone by are stamped as
 * passed.
 *
 * Deliberately generates **one occurrence at a time** (B4). After downtime the
 * next pass creates the next occurrence from now and nothing else — a weekend
 * offline does not produce a wall of already-missed reminders.
 */
export class TaskGeneratorService implements ITaskGeneratorService {
  constructor(
    private readonly tasksRepository: ITasksRepository,
    private readonly repeatedTasksRepository: IRepeatedTasksRepository,
  ) {}

  async markPassedEvents(now: Date): Promise<EventTask[]> {
    const tasks = await this.tasksRepository.listAcrossUsers();
    const newlyPassed = tasks
      .filter(isEventTask)
      .filter((event) => event.passedDate === null && event.date <= now);

    const stamped = await Promise.all(
      newlyPassed.map((event) => this.tasksRepository.markEventPassed(event.id, now)),
    );

    return stamped.filter((event): event is EventTask => event !== null);
  }

  /**
   * Gives a config the occurrence it should have right now.
   *
   * Usually that is the next one. But a repeat made *after* today's time has
   * gone by would otherwise show nothing until tomorrow — set up a daily 08:00
   * routine at 10:00 and the app has nothing to say about today, though the
   * window you asked for is still wide open. So if today's occurrence has
   * already begun and is still worth doing, that is the one it gets, and the
   * poller adds tomorrow's beside it on its next pass, exactly as it does every
   * other day once a date goes by.
   *
   * Only this path looks backwards. `syncPendingEvents` must not: an occurrence
   * whose date has passed never counts as pending, so the poller would make a
   * fresh copy of it on every single pass.
   */
  async ensurePendingEvent(config: RepeatedTask, now: Date): Promise<EventTask | null> {
    if (!config.enabled) return null;

    const tasks = await this.tasksRepository.listBy({ userId: config.userId });
    if (pendingEventOfConfig(tasks, config.id, now) !== null) return null;

    return this.generateUnderwayOrNext(config, tasks, now);
  }

  /**
   * The occurrence a config should be given: the one already underway when
   * there is one, otherwise the next.
   *
   * `existing` is what the config already has, so an occurrence underway that
   * is *already* in the list is left alone. That state is not unusual — it is
   * every ordinary mid-window moment, started with its successor not yet made —
   * and without the check this puts the same occurrence in twice.
   */
  private async generateUnderwayOrNext(
    config: RepeatedTask,
    existing: Task[],
    now: Date,
  ): Promise<EventTask | null> {
    const begun = occurrenceUnderway(config, now);
    if (begun !== null && !hasEventOn(existing, config.id, begun)) {
      return this.generateUnderway(config, begun, now);
    }

    return this.generateNextFrom(config, now);
  }

  /**
   * An occurrence whose moment is behind us, so its reminder is for a time the
   * person was present for — they were in the app, making the repeat. Stamped
   * as already announced, or the poller would read it out to them a minute
   * later. Same reasoning as the guard that stops a machine waking after a day
   * down and announcing yesterday.
   */
  private async generateUnderway(
    config: RepeatedTask,
    date: Date,
    now: Date,
  ): Promise<EventTask | null> {
    const event = await this.tasksRepository.createGeneratedEvent(config, date);

    return this.tasksRepository.markNotified(event.id, now);
  }

  /**
   * Stops a config without losing it: takes back the occurrence it had waiting.
   *
   * Pausing is for a rule you are not doing at the moment, so leaving its
   * pending occurrence in the list would defeat the point — it would sit there
   * until its window shut and then never be replaced, which reads as a task you
   * forgot rather than a repeat you stopped. Only an untouched, still-future
   * one goes: `isUnstartedEvent` is the same guard `regenerateForConfig` uses,
   * because this is the same irreversible act. A session you have started, and
   * anything already over, is the record of something that happened and stays.
   */
  async pauseConfig(config: RepeatedTask, now: Date): Promise<number> {
    const tasks = await this.tasksRepository.listBy({ userId: config.userId });
    const disposable = eventsOfConfig(tasks, config.id).filter(
      (event) => isUnstartedEvent(event) && !isPassedEvent(event, now),
    );

    return this.tasksRepository.deleteManyByIds(
      disposable.map((event) => event.id),
      config.userId,
    );
  }

  async syncPendingEvents(now: Date): Promise<EventTask[]> {
    // One read of each store, then one decision per config against that single
    // snapshot. This is why the work can run in parallel: nothing re-reads
    // mid-way, so no config decides against a store another has already
    // changed. The writes themselves are serialised by the repository queue.
    const [tasks, configs] = await Promise.all([
      this.tasksRepository.listAcrossUsers(),
      this.repeatedTasksRepository.listAcrossUsers(),
    ]);

    const needingEvent = configs
      // A paused config is simply not asked. This is the whole of what pausing
      // does to the poller — no other pass filters on it, because no other pass
      // creates anything.
      .filter((config) => config.enabled)
      .filter((config) => pendingEventOfConfig(tasks, config.id, now) === null);

    const generated = await Promise.all(
      needingEvent.map((config) => this.generateNextFrom(config, now)),
    );

    return generated.filter((event): event is EventTask => event !== null);
  }

  /**
   * The schedule moved, so the occurrences it produced no longer follow from it
   * — but only the ones nobody has touched.
   *
   * This used to delete *every* event the config had ever made, which meant
   * editing a repeat to fix a typo erased months of finished sessions. A
   * generated event holds nothing a client typed, so throwing away an untouched
   * future one costs nothing; a finished one is the only record that the
   * occurrence happened at all, and changing the rule today does not un-happen
   * it. Anything started or already spent is kept exactly where it is.
   */
  async regenerateForConfig(config: RepeatedTask, now: Date): Promise<EventTask | null> {
    if (!config.enabled) {
      await this.pauseConfig(config, now);

      return null;
    }

    const tasks = await this.tasksRepository.listBy({ userId: config.userId });
    const events = eventsOfConfig(tasks, config.id);
    const disposable = events.filter(
      (event) => isUnstartedEvent(event) && !isPassedEvent(event, now),
    );

    await this.tasksRepository.deleteManyByIds(
      disposable.map((event) => event.id),
      config.userId,
    );

    // A started occurrence that is still ahead stays pending, and generating
    // beside it would put two of the same thing in the list.
    //
    // A *finished* one does not count, the same way it does not in
    // `generateNextAfter`: it is a record of something done, not something
    // waiting. Without that clause, finishing an occurrence early and then
    // changing the schedule left the config with nothing pending at all.
    const disposed = new Set(disposable.map((event) => event.id));
    const surviving = events.filter((event) => !disposed.has(event.id));
    const stillPending = surviving.some(
      (event) => event.status !== TaskStatus.DONE && !hasDatePassed(event.date, now),
    );

    // Judged against what survived rather than what was read: the deletes above
    // have already happened, and the stale list would hide an occurrence this
    // very call removed.
    return stillPending ? null : this.generateUnderwayOrNext(config, surviving, now);
  }

  /**
   * The schedule did not move, so every occurrence is still on the right date —
   * they just need what the config now says. Name, category, links, window and
   * steps are all inherited, so all of them are rewritten; the date, the status
   * and the reminder stamp belong to the occurrence and are left alone.
   *
   * Every occurrence still ahead of you is rewritten, **including one you have
   * already started**. That is the point of the whole path: correcting a repeat
   * from 30kg to 35kg has to show up on the session you are in the middle of,
   * and it used to be skipped the moment a single set was ticked, so the list
   * went on saying 30kg while the edit sheet said 35kg. The ticks survive it —
   * `applyConfigToEvent` merges the steps rather than replacing them.
   *
   * What is *not* rewritten is an occurrence that is over: finished, or with its
   * window shut under *both* the window it has and the one the config is about
   * to give it. Widening `activeForMins` is a statement about the occurrence in
   * front of you — "this needs longer than I gave it" — so it reopens one whose
   * old window had already shut. A finished occurrence still never comes back.
   */
  async refreshEventsOfConfig(config: RepeatedTask, now: Date): Promise<EventTask[]> {
    const tasks = await this.tasksRepository.listBy({ userId: config.userId });
    const refreshable = eventsOfConfig(tasks, config.id)
      .filter((event) => isRewritableEvent(event, now, config));

    const updated = await Promise.all(
      refreshable.map((event) => this.tasksRepository.applyConfigToEvent(event, config)),
    );

    return updated.filter((event): event is EventTask => event !== null);
  }

  async generateNextAfter(event: EventTask, now: Date): Promise<EventTask | null> {
    if (event.configTaskId === null) return null;

    const config = await this.repeatedTasksRepository.getById(event.configTaskId);
    if (config === null) return null;
    // Finishing the last occurrence of a paused repeat ends it, rather than
    // quietly starting the rule up again.
    if (!config.enabled) return null;

    // The poller may already have moved this config on. Finishing an event that
    // had *already* passed means `syncPendingEvents` generated its successor on
    // some tick in between, and generating a second one here is what put two
    // identical occurrences in the list.
    //
    // The check cannot simply be `pendingEventOfConfig`, because finishing
    // early — the case this method exists for — leaves the event being finished
    // sitting there unpassed and would block its own successor. So the event in
    // hand is excluded, and a finished one never counts as still waiting.
    const tasks = await this.tasksRepository.listBy({ userId: config.userId });
    const successor = eventsOfConfig(tasks, config.id).find((other) => (
      other.id !== event.id
      && other.status !== TaskStatus.DONE
      && !hasDatePassed(other.date, now)
    ));
    if (successor !== undefined) return null;

    // Measured from the finished event's own date when that is still ahead, so
    // finishing early yields the *following* occurrence, not the same one again.
    const from = event.date > now ? event.date : now;

    return this.generateNextFrom(config, from);
  }

  /** The one place an occurrence is turned into a stored event. */
  private async generateNextFrom(config: RepeatedTask, after: Date): Promise<EventTask | null> {
    const date = nextOccurrence(config, after);
    if (date === null) return null;

    return this.tasksRepository.createGeneratedEvent(config, date);
  }
}
