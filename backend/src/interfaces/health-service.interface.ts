import type { HealthStatus } from "../types/health.types.js";

export interface IHealthService {
  health(): Promise<HealthStatus>;
}