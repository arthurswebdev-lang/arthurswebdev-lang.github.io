import type { ContentBlock, MessageParam } from '../types/assistant.types.js';

/** What one model call answers with — the part the turn loop reads. */
export interface AssistantModelReply {
  content: ContentBlock[];
  stopReason: string | null;
}

/**
 * The seam between the assistant and the Claude API. The real one wraps the
 * SDK; tests hand in a fake that returns canned replies, so `npm test` stays
 * offline and free.
 */
export interface IAssistantClient {
  send(messages: MessageParam[]): Promise<AssistantModelReply>;
  /**
   * The smallest possible real call, to learn whether the API answers at all.
   * Throws for any reason it does not: a bad or expired key, no credit, an
   * outage.
   */
  ping(): Promise<void>;
}
