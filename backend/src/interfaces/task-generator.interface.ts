import type { EventTask } from '../types/tasks.types.js';
import type { RepeatedTask } from '../types/repeated-tasks.types.js';

export interface ITaskGeneratorService {
  /** Stamps `passedDate` on every event whose moment has gone by. */
  markPassedEvents(now: Date): Promise<EventTask[]>;

  /** Creates the config's next event if it has none pending. */
  ensurePendingEvent(config: RepeatedTask, now: Date): Promise<EventTask | null>;

  /** Runs `ensurePendingEvent` for every config in the store. */
  syncPendingEvents(now: Date): Promise<EventTask[]>;

  /** Wipes a config's events and generates a fresh pending one (B5). */
  /**
   * Pushes the config's inherited fields onto the occurrences it has waiting,
   * for a change that leaves the schedule alone. Started and spent ones are
   * left as they are.
   */
  refreshEventsOfConfig(config: RepeatedTask, now: Date): Promise<EventTask[]>;

  regenerateForConfig(config: RepeatedTask, now: Date): Promise<EventTask | null>;

  /** Generates the follow-up occurrence after an event is finished early (B3). */
  generateNextAfter(event: EventTask, now: Date): Promise<EventTask | null>;
}
