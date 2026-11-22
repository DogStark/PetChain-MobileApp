import { Pool, type PoolConfig } from 'pg';

import config from '../../config';
import { traceDbQuery } from '../../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    // If we are in test environment and no DATABASE_URL is provided, we might want to skip real connection
    if (process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL) {
      console.warn('No DATABASE_URL provided in test environment. Database operations will fail.');
    }

    const poolConfig: PoolConfig = {
      connectionString: config.database.url,
      max: config.database.poolSize,
      idleTimeoutMillis: config.database.idleTimeoutMillis,
    };

    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.error('Unexpected error on idle database client', err);
    });

    pool.on('connect', () => {
      if (config.isDev) {
        console.warn('Database connected');
      }
    });
  }
  return pool;
}

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  // Sentry span per query; parameter values are never attached (#1392).
  const res = await traceDbQuery(text, () => getPool().query(text, params));
  const duration = Date.now() - start;

  if (config.isDev) {
    console.warn('Executed query', { text, duration, rows: res.rowCount });
  }

  return res;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
