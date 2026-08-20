import type { Device } from '../types/device.types.js';

export interface IDevicesService {
  /** Registers this install against the caller, so its events can reach it. */
  register(userId: string, token: string): Promise<Device>;
}
