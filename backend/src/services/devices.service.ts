import type { IDevicesRepository } from '../interfaces/devices-repository.interface.js';
import type { IDevicesService } from '../interfaces/devices-service.interface.js';
import type { Device } from '../types/device.types.js';

/**
 * Thin on purpose: registering a device is one write and carries no rules of
 * its own. It exists so the controller depends on an interface rather than on
 * the repository, like every other resource here.
 */
export class DevicesService implements IDevicesService {
  constructor(private readonly devicesRepository: IDevicesRepository) {}

  register(userId: string, token: string): Promise<Device> {
    return this.devicesRepository.upsert({ token }, userId);
  }
}
