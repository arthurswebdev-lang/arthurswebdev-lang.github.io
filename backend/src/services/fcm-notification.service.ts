import type { Messaging, WebpushConfig } from 'firebase-admin/messaging';

import type { IDevicesRepository } from '../interfaces/devices-repository.interface.js';
import type { INotificationService } from '../interfaces/notification-service.interface.js';
import { TaskStatus } from '../enum/task-status.enum.js';
import type { EventTask } from '../types/tasks.types.js';

/**
 * FCM's two ways of saying "this install is gone": the browser was uninstalled,
 * or the token was replaced. Anything else — a network blip, a malformed
 * payload, a quota — is our problem, not the token's, and must not delete a row
 * that would have worked on the next pass.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function isDeadToken(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && DEAD_TOKEN_CODES.has(error.code);
}

/** What the alert says under the task's name. */
function describe(task: EventTask): string {
  const remaining = task.subtasks.filter((subtask) => subtask.status !== TaskStatus.DONE).length;
  if (remaining === 0) return 'Due now';

  return remaining === 1 ? 'Due now — 1 step left' : `Due now — ${String(remaining)} steps left`;
}

/**
 * Delivers a due event as a real push, through Firebase Cloud Messaging.
 *
 * The counterpart of `ConsoleNotificationService`: `EventPollingService` knows
 * only the interface, so which one is wired in is a deployment decision made in
 * `server.ts`, not a change to the polling logic.
 */
export class FcmNotificationService implements INotificationService {
  constructor(
    private readonly devicesRepository: IDevicesRepository,
    private readonly messaging: Messaging,
    /** Where a tapped notification opens. Omitted when not configured. */
    private readonly appUrl: string | undefined,
  ) {}

  notify(task: EventTask): Promise<void> {
    return this.announce(task.userId, task.name, describe(task));
  }

  /**
   * One message, every install its owner registered. Nobody registered means no
   * work, which is what makes this safe to run for accounts that never turned
   * notifications on.
   */
  async announce(userId: string, title: string, body: string): Promise<void> {
    const devices = await this.devicesRepository.listByUserId(userId);
    if (devices.length === 0) return;

    // Read the list once and fan out: awaiting per device would make a user
    // with a phone and a laptop wait two round-trips for one message.
    const outcomes = await Promise.all(devices.map((d) => this.send(d.token, title, body)));
    const dead = outcomes.filter((token): token is string => token !== null);

    await Promise.all(dead.map((token) => this.devicesRepository.deleteByToken(token)));
  }

  /**
   * Urgency:high asks for delivery now rather than batched with whatever else
   * is queued. It governs *delivery*, not loudness — the sound a phone makes
   * for a web push is the system's, and no field here can raise it.
   *
   * requireInteraction, renotify and vibrate are ignored on iOS and honoured
   * everywhere else, so they cost nothing to send.
   */
  private webpushFor(title: string, body: string): WebpushConfig {
    return {
      headers: { Urgency: 'high', TTL: '600' },
      notification: {
        title,
        body,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        requireInteraction: true,
        renotify: true,
        tag: 'tasks',
        vibrate: [200, 100, 200],
      },
      ...(this.appUrl === undefined ? {} : { fcmOptions: { link: this.appUrl } }),
    };
  }

  /** Sends one push. Returns the token when FCM says it is dead, else `null`. */
  private async send(token: string, title: string, body: string): Promise<string | null> {
    try {
      await this.messaging.send({
        token,
        notification: { title, body },
        webpush: this.webpushFor(title, body),
      });

      return null;
    } catch (error) {
      if (isDeadToken(error)) return token;

      // A failed send is not retried: the poller's window has already moved
      // past this task, and a second attempt would need durable state the
      // service deliberately does not keep. See EventPollingService.
      console.error(`[fcm] push failed for "${title}":`, error);

      return null;
    }
  }
}
