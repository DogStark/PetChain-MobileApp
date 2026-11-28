import path from 'path';

import { runner } from 'node-pg-migrate';
import { Pool, type QueryConfig, type QueryResult } from 'pg';

import { traceDbQuery } from '../utils/logger';

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

// ── Multi-region read replica failover (#1352) ────────────────────────────────
const DATABASE_REPLICA_URL = process.env.DATABASE_REPLICA_URL || '';
const PRIMARY_HEALTH_RECHECK_MS = Number(process.env.DB_PRIMARY_RECHECK_MS) || 30_000;

/** Read replica pool; null when DATABASE_REPLICA_URL is not configured. */
export const replicaPool: Pool | null = DATABASE_REPLICA_URL
  ? new Pool({
      connectionString: DATABASE_REPLICA_URL,
      max: Number(process.env.DB_REPLICA_POOL_MAX) || 20,
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 10000,
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 3000,
    })
  : null;

replicaPool?.on('error', (err) => {
  console.error('[db:replica] Unexpected pool error:', err.message);
});

let primaryHealthy = true;
let primaryRecheckTimer: ReturnType<typeof setInterval> | null = null;

export function isPrimaryHealthy(): boolean {
  return primaryHealthy;
}

export function isReplicaConfigured(): boolean {
  return replicaPool !== null;
}

/** True when the query only reads data and may be served by the replica. */
export function isReadOnlyQuery(text: string): boolean {
  const normalised = text.replace(/^\s*(?:\/\*[\s\S]*?\*\/|--[^\n]*\n|\s)+/, '').trimStart();
  return /^(select|with)\b/i.test(normalised) && !/\bfor\s+(?:no\s+key\s+)?update\b/i.test(normalised);
}

function logFailover(reason: string): void {
  console.warn(`[db:failover] Primary database unreachable (${reason}); routing read-only queries to replica.`);
}

function logRestore(): void {
  console.warn('[db:failover] Primary database healthy again; restoring primary traffic.');
}

function startPrimaryRecheck(): void {
  if (primaryRecheckTimer) return;
  primaryRecheckTimer = setInterval(() => {
    void recheckPrimaryHealth();
  }, PRIMARY_HEALTH_RECHECK_MS);
  // Do not keep the process alive solely for the health check.
  primaryRecheckTimer.unref?.();
}

function stopPrimaryRecheck(): void {
  if (!primaryRecheckTimer) return;
  clearInterval(primaryRecheckTimer);
  primaryRecheckTimer = null;
}

/** Probe the primary; restores traffic automatically once it responds. */
export async function recheckPrimaryHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    if (!primaryHealthy) {
      primaryHealthy = true;
      logRestore();
    }
    stopPrimaryRecheck();
    return true;
  } catch {
    return false;
  }
}

function markPrimaryUnhealthy(reason: string): void {
  if (primaryHealthy) {
    primaryHealthy = false;
    logFailover(reason);
  }
  startPrimaryRecheck();
}

/** Test helper: reset failover state and stop the health re-check timer. */
export function resetFailoverState(): void {
  primaryHealthy = true;
  stopPrimaryRecheck();
}

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
 * Runs a query against the primary pool, falling back to the read replica for
 * read-only statements when the primary is unreachable (#1352).
 */
async function executeWithFailover(
  textOrConfig: string | QueryConfig,
  params: unknown[] | undefined,
  rawText: string,
): Promise<QueryResult> {
  try {
    const result = await pool.query(textOrConfig as string, params);
    if (!primaryHealthy) {
      primaryHealthy = true;
      logRestore();
      stopPrimaryRecheck();
    }
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    markPrimaryUnhealthy(reason);
    if (replicaPool && isReadOnlyQuery(rawText)) {
      console.warn(`[db:failover] Serving read-only query from replica (reason: ${reason}).`);
      return replicaPool.query(textOrConfig as string, params);
    }
    throw err;
  }
}

/**
 * Executes a parameterised query via the pool and records its duration to the
 * performance monitor. Parameter values are never passed to the logger.
 */
export async function instrumentedQuery(
  textOrConfig: string | QueryConfig,
  params?: unknown[],
): Promise<QueryResult> {
  const rawText = typeof textOrConfig === 'string' ? textOrConfig : (textOrConfig.text ?? '');
  const start = Date.now();
  // Sentry span per query; parameter values are never attached (#1392).
  const result = await traceDbQuery(rawText, () =>
    executeWithFailover(textOrConfig, params, rawText),
  );
  const durationMs = Date.now() - start;

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

/**
 * Verify the read replica connection is healthy (no-op when unconfigured).
 */
export async function checkReplicaConnection(): Promise<void> {
  if (!replicaPool) return;
  const client = await replicaPool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

/**
 * Returns connection pool statistics.
 */
export function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    primaryHealthy,
    replicaConfigured: replicaPool !== null,
    replica: replicaPool
      ? {
          total: replicaPool.totalCount,
          idle: replicaPool.idleCount,
          waiting: replicaPool.waitingCount,
        }
      : null,
  };
}
