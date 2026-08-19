export interface SingleServiceStatus {
  ok: boolean;
  error?: string;
}

export interface HealthStatus {
  dbConnection: SingleServiceStatus;
  server: SingleServiceStatus;
}