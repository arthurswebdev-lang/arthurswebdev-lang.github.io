import type { IDevicesRepository } from '../interfaces/devices-repository.interface.js';
import type { IDevicesService } from '../interfaces/devices-service.interface.js';
import type { INotificationService } from '../interfaces/notification-service.interface.js';
import type { Device } from '../types/device.types.js';

/**
 * Registering a device, and proving to its owner that the registration works.
 *
 * The test send lives here rather than in a script because the question it
 * answers — "is anything wrong between this phone and me?" — is one only the
 * person holding the phone can see the answer to.
 */
export class DevicesService implements IDevicesService {
  constructor(
    private readonly devicesRepository: IDevicesRepository,
    private readonly notifications: INotificationService,
  ) {}

  register(userId: string, token: string): Promise<Device> {
    return this.devicesRepository.upsert({ token }, userId);
  }

  /** Returns how many installs it went to, so the caller can say "none". */
  async sendTest(userId: string): Promise<number> {
    const devices = await this.devicesRepository.listByUserId(userId);
    if (devices.length === 0) return 0;

    await this.notifications.announce(userId, 'Tasks', 'Test notification — this is how it sounds');

    return devices.length;
  }
}
