import type { AssistantSession } from '../types/assistant.types.js';

export interface IAssistantSessionsRepository {
  ensureIndexes(): Promise<void>;
  create(session: AssistantSession): Promise<void>;
  /** The session, only when it belongs to this user. */
  get(id: string, userId: string): Promise<AssistantSession | null>;
  save(session: AssistantSession): Promise<void>;
  delete(id: string, userId: string): Promise<boolean>;
  /**
   * Moves `proposed` to `accepted` in one atomic step, so a double tap cannot
   * accept twice. False when there was no plan waiting.
   */
  accept(id: string, userId: string): Promise<boolean>;
}

export interface IAssistantUsageRepository {
  ensureIndexes(): Promise<void>;
  /** Counts one more request for this user today and returns today's total. */
  increment(userId: string, now: Date): Promise<number>;
}
