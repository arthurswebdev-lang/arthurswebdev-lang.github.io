import { type Db, MongoClient } from 'mongodb';

/**
 * Owns the Mongo connection for the process. Repositories receive the `Db` it
 * hands out; nothing else touches the client.
 */
export class MongoStorage {
  private client: MongoClient | null = null;

  constructor(private readonly uri: string, private readonly dbName: string) {}

  async connect(): Promise<Db> {
    try {
      this.client = await MongoClient.connect(this.uri);

      return this.client.db(this.dbName);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      throw new Error(`Error connecting to MongoDB: ${reason}`, { cause: error });
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}
