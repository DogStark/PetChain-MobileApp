import path from 'path';

import { runner } from 'node-pg-migrate';
import { Pool, type QueryConfig, type QueryResult } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/petchain';

// ── Connection pool ────────────────────────────────────────────────────────────
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 10000,
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 3000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

// ── Instrumented query wrapper ─────────────────────────────────────────────────

/**
 * Strips all $N parameter placeholders' values from a query string, returning
 * only the sanitised SQL text for logging. Parameter values are never logged.
 */
function sanitizeQueryText(text: string): string {
  // Collapse whitespace and truncate to 500 chars so logs stay readable
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

/**
 * Executes a parameterised query via the pool and records its duration to the
 * performance monitor. Parameter values are never passed to the logger.
 */
export async function instrumentedQuery(
  textOrConfig: string | QueryConfig,
  params?: unknown[],
): Promise<QueryResult> {
  const start = Date.now();
  const result = await pool.query(textOrConfig as string, params);
  const durationMs = Date.now() - start;

  const rawText =
    typeof textOrConfig === 'string' ? textOrConfig : (textOrConfig.text ?? '');
  const sanitised = sanitizeQueryText(rawText);
  const rowCount = result.rowCount ?? 0;

  // Lazy import to avoid circular dependency at module load time
  let recorder: typeof import('../middleware/performanceLogger').recordQueryMetric | null = null;
  try {
    recorder = (
      require('../middleware/performanceLogger') as typeof import('../middleware/performanceLogger')
    ).recordQueryMetric;
  } catch {
    // If the middleware isn't loaded yet, skip recording silently
  }
  recorder?.(sanitised, durationMs, rowCount);

  return result;
}

// ── Migration runner ───────────────────────────────────────────────────────────

export interface PostgresMigrationOptions {
  migrationsDir?: string;
  databaseUrl?: string;
}

/**
 * Run all pending UP migrations using node-pg-migrate.
 * Safe to call on every server startup — already-applied migrations are skipped.
 * Uses an advisory lock internally so concurrent startups don't race.
 */
let _pgMigrationsInFlight: Promise<void> | null = null;

export async function runMigrations({
  migrationsDir,
  databaseUrl,
}: PostgresMigrationOptions = {}): Promise<void> {
  if (_pgMigrationsInFlight) return _pgMigrationsInFlight;

  const dir = migrationsDir || path.resolve(__dirname, '..', 'migrations');
  const dbUrl = databaseUrl || process.env.DATABASE_URL || DATABASE_URL;

  console.warn('[db] Running pending PostgreSQL migrations…');

  _pgMigrationsInFlight = (async () => {
    try {
      await runner({
        databaseUrl: dbUrl,
        dir,
        direction: 'up',
        migrationsTable: 'schema_migrations',
        log: (msg: string) => console.warn('[db:migrate]', msg),
      });

      console.warn('[db] Migrations complete.');
    } finally {
      _pgMigrationsInFlight = null;
    }
  })();

  return _pgMigrationsInFlight;
}

/**
 * Roll back the last N migrations (default 1).
 */
export async function rollbackMigrations(
  count = 1,
  { migrationsDir, databaseUrl }: PostgresMigrationOptions = {},
): Promise<void> {
  const dir = migrationsDir || path.resolve(__dirname, '..', 'migrations');
  const dbUrl = databaseUrl || process.env.DATABASE_URL || DATABASE_URL;

  console.warn(`[db] Rolling back ${count} migration(s)…`);

  await runner({
    databaseUrl: dbUrl,
    dir,
    direction: 'down',
    count,
    migrationsTable: 'schema_migrations',
    log: (msg: string) => console.warn('[db:rollback]', msg),
  });

  console.warn('[db] Rollback complete.');
}

/**
 * Verify the database connection is healthy.
 */
export async function checkDatabaseConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
