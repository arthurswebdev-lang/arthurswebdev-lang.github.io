import type { Device, RegisterDevice } from '../types/device.types.js';

export interface IDevicesRepository {
  /** Indexes this collection needs. Called once at startup. */
  ensureIndexes(): Promise<void>;
  /** Every install this user has registered; empty when they never opted in. */
  listByUserId(userId: string): Promise<Device[]>;
  /** Stores the token, or re-dates the row when the token is already known. */
  upsert(input: RegisterDevice, userId: string): Promise<Device>;
  /** Drops a token FCM has told us no longer exists. */
  deleteByToken(token: string): Promise<boolean>;
}
