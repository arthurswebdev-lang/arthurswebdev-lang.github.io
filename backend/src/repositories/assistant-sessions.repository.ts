import type { Collection, Db } from 'mongodb';

import type {
  IAssistantSessionsRepository, IAssistantUsageRepository,
} from '../interfaces/assistant-sessions-repository.interface.js';
import type { AssistantSession } from '../types/assistant.types.js';
import type { Persisted } from './entity.interface.js';

export const ASSISTANT_SESSIONS_COLLECTION = 'assistantSessions';
export const ASSISTANT_USAGE_COLLECTION = 'assistantUsage';

function toDocument(session: AssistantSession): Persisted<AssistantSession> {
  const { id, ...rest } = session;

  return { ...rest, _id: id };
}

function toDomain(document: Persisted<AssistantSession>): AssistantSession {
  const { _id: id, ...rest } = document;

  return { ...rest, id };
}

/**
 * One document per chat session, deleted when the chat ends. Nothing about a
 * chat is meant to outlive it: Create deletes it, closing the sheet deletes it,
 * and a TTL index deletes whatever was abandoned — Mongo removes a document
 * once `expiresAt` has passed (its sweeper runs about once a minute).
 */
export class AssistantSessionsRepository implements IAssistantSessionsRepository {
  private readonly collection: Collection<Persisted<AssistantSession>>;

  constructor(db: Db) {
    this.collection = db.collection<Persisted<AssistantSession>>(ASSISTANT_SESSIONS_COLLECTION);
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.collection.createIndex({ userId: 1 }),
    ]);
  }

  async create(session: AssistantSession): Promise<void> {
    await this.collection.insertOne(toDocument(session));
  }

  async get(id: string, userId: string): Promise<AssistantSession | null> {
    const document = await this.collection.findOne({ _id: id, userId });

    return document === null ? null : toDomain(document);
  }

  async save(session: AssistantSession): Promise<void> {
    await this.collection.replaceOne({ _id: session.id, userId: session.userId }, toDocument(session));
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id, userId });

    return result.deletedCount > 0;
  }

  async accept(id: string, userId: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: id, userId, state: 'proposed' },
      { $set: { state: 'accepted' } },
    );

    return result.modifiedCount > 0;
  }
}

interface UsageDocument {
  _id: string;
  count: number;
  expiresAt: Date;
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Requests per user per UTC day, so a stuck client cannot spend real money in
 * a loop. Holds a number and nothing about what was said.
 */
export class AssistantUsageRepository implements IAssistantUsageRepository {
  private readonly collection: Collection<UsageDocument>;

  constructor(db: Db) {
    this.collection = db.collection<UsageDocument>(ASSISTANT_USAGE_COLLECTION);
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  async increment(userId: string, now: Date): Promise<number> {
    const day = now.toISOString().slice(0, 10);
    const document = await this.collection.findOneAndUpdate(
      { _id: `${userId}:${day}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + TWO_DAYS_MS) } },
      { upsert: true, returnDocument: 'after' },
    );

    return document?.count ?? 1;
  }
}
