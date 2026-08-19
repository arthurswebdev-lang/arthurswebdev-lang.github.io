import type { IHealthService } from '../interfaces/health-service.interface.js';
import type { HealthStatus } from '../types/health.types.js';

export class HealthService implements IHealthService {
  health(): Promise<HealthStatus> {
    return Promise.resolve({
      server: { ok: true },
      // TODO: probe the real connection once a database client is wired up.
      dbConnection: { ok: false, error: 'not configured' },
    });
  }
}
