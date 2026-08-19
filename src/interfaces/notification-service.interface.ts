import type { EventTask } from '../types/tasks.types.js';

export interface INotificationService {
  /**
   * Delivers the "your event is due" notification for one task. Async because
   * every real channel (push, email, websocket) is.
   */
  notify(task: EventTask): Promise<void>;
}
