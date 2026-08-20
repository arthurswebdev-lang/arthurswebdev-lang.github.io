import { randomUUID } from 'node:crypto';

import type { Collection, Db } from 'mongodb';

import type { IDevicesRepository } from '../interfaces/devices-repository.interface.js';
import type { Device, RegisterDevice } from '../types/device.types.js';
import type { Persisted } from './entity.interface.js';

export const DEVICES_COLLECTION = 'devices';

/**
 * Standalone rather than a `MongoRepository`, like `UsersRepository`: a device
 * is never listed, fetched or edited by id — it is looked up by owner when
 * something is due, and by token when it is registered or turns out to be dead.
 * The shared CRUD would all be dead code here.
 */
export class DevicesRepository implements IDevicesRepository {
  private readonly collection: Collection<Persisted<Device>>;

  constructor(db: Db) {
    this.collection = db.collection<Persisted<Device>>(DEVICES_COLLECTION);
  }

  /**
   * A token addresses exactly one install, so it gets a unique index: that is
   * what turns re-registering the same browser into an update instead of a
   * second row that would make every notification arrive twice.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ token: 1 }, { unique: true }),
      this.collection.createIndex({ userId: 1 }),
    ]);
  }

  async listByUserId(userId: string): Promise<Device[]> {
    const documents = await this.collection.find({ userId }).toArray();

    return documents.map(({ _id: id, ...rest }) => ({ ...rest, id }));
  }

  /**
   * An upsert, because the client registers on every launch and FCM hands back
   * the same token each time. Keyed on the token rather than the user: the same
   * browser signing in as someone else must move, not accumulate.
   */
  async upsert(input: RegisterDevice, userId: string): Promise<Device> {
    const now = new Date();
    const document = await this.collection.findOneAndUpdate(
      { token: input.token },
      {
        $set: { userId, updatedAt: now },
        $setOnInsert: { _id: randomUUID(), token: input.token, createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );

    // Unreachable with `upsert: true`, but the driver's type allows it.
    if (document === null) throw new Error('Device registration stored nothing.');

    const { _id: id, ...rest } = document;

    return { ...rest, id };
  }

  async deleteByToken(token: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ token });

    return result.deletedCount > 0;
  }
}
