import type { EventTask } from '../types/tasks.types.js';

export interface INotificationService {
  /**
   * Delivers the "your event is due" notification for one task. Async because
   * every real channel (push, email, websocket) is.
   */
  notify(task: EventTask): Promise<void>;

  /**
   * The same delivery with no task behind it, for the "does this actually
   * reach me?" check the app offers once notifications are on. Separate from
   * `notify` so a test never has to invent an EventTask that does not exist.
   */
  announce(userId: string, title: string, body: string): Promise<void>;
}
