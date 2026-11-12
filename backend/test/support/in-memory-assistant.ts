import type {
  AssistantModelReply, IAssistantClient,
} from '../../src/interfaces/assistant-client.interface.js';
import type {
  IAssistantSessionsRepository, IAssistantUsageRepository,
} from '../../src/interfaces/assistant-sessions-repository.interface.js';
import type {
  AssistantSession, ContentBlock, MessageParam,
} from '../../src/types/assistant.types.js';

/** Sessions in a Map, copied in and out so a test cannot share state by accident. */
export class InMemoryAssistantSessions implements IAssistantSessionsRepository {
  readonly sessions = new Map<string, AssistantSession>();

  async ensureIndexes(): Promise<void> {
    await Promise.resolve();
  }

  async create(session: AssistantSession): Promise<void> {
    await this.save(session);
  }

  async get(id: string, userId: string): Promise<AssistantSession | null> {
    const session = this.sessions.get(id);

    return Promise.resolve(session?.userId === userId ? structuredClone(session) : null);
  }

  async save(session: AssistantSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
    await Promise.resolve();
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (session?.userId !== userId) return Promise.resolve(false);

    return Promise.resolve(this.sessions.delete(id));
  }

  async accept(id: string, userId: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (session?.userId !== userId || session.state !== 'proposed') return Promise.resolve(false);
    session.state = 'accepted';

    return Promise.resolve(true);
  }
}

export class CountingUsage implements IAssistantUsageRepository {
  count = 0;

  async ensureIndexes(): Promise<void> {
    await Promise.resolve();
  }

  async increment(): Promise<number> {
    this.count += 1;

    return Promise.resolve(this.count);
  }
}

/** A tool call block as the API returns it. */
export const toolUse = (id: string, name: string, input: object): ContentBlock =>
  ({ type: 'tool_use', id, name, input }) as unknown as ContentBlock;

export const text = (value: string): ContentBlock =>
  ({ type: 'text', text: value, citations: null }) as unknown as ContentBlock;

/**
 * Plays back scripted replies and records every conversation it was sent, so
 * a test can check what the model would have seen.
 */
export class ScriptedClient implements IAssistantClient {
  readonly seen: MessageParam[][] = [];

  /** Set to an error to make the health ping fail, the way an expired key would. */
  pingError: Error | null = null;

  pings = 0;

  constructor(private readonly replies: AssistantModelReply[]) {}

  async send(messages: MessageParam[]): Promise<AssistantModelReply> {
    this.seen.push(structuredClone(messages));
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error('The script ran out of replies.');

    return Promise.resolve(reply);
  }

  async ping(): Promise<void> {
    this.pings += 1;
    if (this.pingError !== null) throw this.pingError;
    await Promise.resolve();
  }
}

export const reply = (...content: ContentBlock[]): AssistantModelReply => ({
  content,
  stopReason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
});
