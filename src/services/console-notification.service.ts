import type { INotificationService } from '../interfaces/notification-service.interface.js';
import type { EventTask } from '../types/tasks.types.js';

/**
 * Placeholder delivery channel: prints the notification instead of sending it.
 * Swap this implementation for push/email/websocket without touching the
 * polling service, which only knows the interface.
 */
export class ConsoleNotificationService implements INotificationService {
  notify(task: EventTask): Promise<void> {
    console.log(`[notification] "${task.name}" is due at ${task.date.toISOString()} (${task.id})`);

    return Promise.resolve();
  }
}
