import pg from 'pg';
import type { Pool, PoolClient, PoolConfig } from 'pg';

const { Pool: PgPool } = pg;

export class DatabaseConnectionError extends Error {
  public readonly code = 'DATABASE_UNAVAILABLE';

  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'DatabaseConnectionError';
  }
}

export interface DatabasePoolOptions {
  connectionString: string;
  ssl?: boolean;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export function createDatabasePool(options: DatabasePoolOptions): Pool {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  };

  return new PgPool(config);
}

export async function pingDatabase(pool: Pick<Pool, 'query'>): Promise<{
  reachable: boolean;
  latencyMs: number;
}> {
  const started = Date.now();
  try {
    await pool.query('SELECT 1 AS ok');
    return { reachable: true, latencyMs: Date.now() - started };
  } catch (err) {
    throw new DatabaseConnectionError('Unable to reach PostgreSQL database.', err);
  }
}

export async function withTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  fn: (client: Pick<PoolClient, 'query'>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure when original error is already raised
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDatabasePool(pool: Pick<Pool, 'end'> | null): Promise<void> {
  if (!pool) return;
  await pool.end();
}
