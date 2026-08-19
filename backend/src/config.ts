import { config as loadEnv } from 'dotenv';
// Loaded here rather than in server.ts: ESM evaluates an imported module before
// the body of the module importing it, so anything reading process.env in this
// file would run before a loadEnv() call made anywhere else. Variables already
// set in the real environment win — dotenv does not overwrite them.
loadEnv({ quiet: true });

export interface Config {
  readonly port: number;
  readonly nodeEnv: string;
  /** Mongo connection string. */
  readonly mongoUrl: string;
  /** Database the collections live in. */
  readonly mongoDbName: string;
  /** Origins allowed to call this API. `*` (the default) allows any. */
  readonly allowedOrigins: string[];
  /** How often the event poller looks for tasks that just came due. */
  readonly pollIntervalMs: number;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined) return 3000;

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }

  return port;
}

function readPollInterval(raw: string | undefined): number {
  if (raw === undefined) return 60_000;

  const interval = Number.parseInt(raw, 10);
  if (!Number.isInteger(interval) || interval < 100) {
    throw new Error(`Invalid POLL_INTERVAL_MS: ${raw}`);
  }

  return interval;
}

export const config: Config = {
  port: readPort(process.env['PORT']),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  mongoUrl: process.env['MONGO_URL'] ?? 'mongodb://127.0.0.1:27017',
  mongoDbName: process.env['MONGO_DB_NAME'] ?? 'todo-list',
  allowedOrigins: (process.env['ORIGIN'] ?? '*').split(',').map((origin) => origin.trim()),
  pollIntervalMs: readPollInterval(process.env['POLL_INTERVAL_MS']),
};
