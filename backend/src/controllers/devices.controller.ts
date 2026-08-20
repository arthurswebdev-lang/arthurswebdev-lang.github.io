import type { NextFunction, Response } from 'express';

import type { IDevicesService } from '../interfaces/devices-service.interface.js';
import { currentUserId } from '../middlewares/auth.middleware.js';
import type { Device, RegisterDevice } from '../types/device.types.js';
import type { BodyRequest } from '../types/request.type.js';
import * as SuccessHandlerUtil from '../utils/success-handler.util.js';

export class DevicesController {
  constructor(private readonly devicesService: IDevicesService) {}

  /**
   * Registering twice from the same install is normal, not an error — the
   * client does it on every launch to catch a token FCM has rotated — so this
   * answers 201 either way rather than distinguishing create from update.
   */
  async register(
    request: BodyRequest<RegisterDevice>,
    response: Response<Device>,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = currentUserId(response);
      const device = await this.devicesService.register(userId, request.body.token);
      SuccessHandlerUtil.handleAdd(response, next, device);
    } catch (error) {
      next(error);
    }
  }
}
