/**
 * SQLite migration runner for the PetChain mobile app.
 *
 * - Uses a `schema_migrations` table to track applied migrations.
 * - Migrations are identified by a timestamp-based version string (e.g. "20260101000001").
 * - Runs inside a transaction where SQLite supports it.
 * - Safe to call on every app startup — already-applied migrations are skipped.
 */

import type * as SQLite from 'expo-sqlite';

export interface SqliteMigration {
  /** Timestamp-based version string, e.g. "20260101000001". Must be unique and sortable. */
  version: string;
  description: string;
  /**
   * Stable checksum of this migration's content.
   * Used to detect if a migration file was edited after being applied.
   * Compute with: computeMigrationChecksum(version, upFnSource)
   */
  checksum: string;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
  down: (db: SQLite.SQLiteDatabase) => Promise<void>;
}

export interface SqliteMigrationRecord {
  version: string;
  description: string;
  applied_at: string;
  status: 'applied' | 'rolled_back';
}

export interface SqliteMigrationResult {
  success: boolean;
  migrationsRun: number;
  appliedVersions: string[];
  error?: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Simple djb2 hash — fast, no crypto dependency, good enough for drift detection.
 */
export function computeMigrationChecksum(version: string, content: string): string {
  const str = `${version}::${content}`;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16);
}

async function ensureMigrationsTable(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY NOT NULL,
      description TEXT NOT NULL,
      checksum TEXT NOT NULL DEFAULT '',
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'applied'
    )
  `);
  // Add checksum column to existing installs that predate this field
  try {
    await db.execAsync(
      `ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT ''`,
    );
  } catch {
    /* column already exists */
  }
}

async function getAppliedVersions(db: SQLite.SQLiteDatabase): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ version: string; checksum: string }>(
    `SELECT version, checksum FROM schema_migrations WHERE status = 'applied' ORDER BY version ASC`,
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

async function recordMigration(
  db: SQLite.SQLiteDatabase,
  version: string,
  description: string,
  checksum: string,
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO schema_migrations (version, description, checksum, applied_at, status)
     VALUES (?, ?, ?, datetime('now'), 'applied')`,
    [version, description, checksum],
  );
}

async function recordRollback(db: SQLite.SQLiteDatabase, version: string): Promise<void> {
  await db.runAsync(`UPDATE schema_migrations SET status = 'rolled_back' WHERE version = ?`, [
    version,
  ]);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Run all pending migrations in ascending version order.
 * Safe to call on every app startup.
 */
export async function runSqliteMigrations(
  db: SQLite.SQLiteDatabase,
  migrations: SqliteMigration[],
): Promise<SqliteMigrationResult> {
  // Prevent concurrent runs within the same process
  if ((runSqliteMigrations as any)._inFlight) {
    return { success: true, migrationsRun: 0, appliedVersions: [] };
  }
  (runSqliteMigrations as any)._inFlight = true;

  await ensureMigrationsTable(db);

  const applied = await getAppliedVersions(db);
  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version.localeCompare(b.version));

  if (pending.length === 0) {
    return { success: true, migrationsRun: 0, appliedVersions: [] };
  }

  const appliedVersions: string[] = [];

  for (const migration of pending) {
    try {
      await db.withTransactionAsync(async () => {
        await migration.up(db);
        await recordMigration(db, migration.version, migration.description, migration.checksum);
      });
      appliedVersions.push(migration.version);
    } catch (err) {
      // Attempt rollback of the failed migration
      try {
        await migration.down(db);
      } catch {
        // Rollback failure is secondary — surface the original error
      }
      return {
        success: false,
        migrationsRun: appliedVersions.length,
        appliedVersions,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { success: true, migrationsRun: pending.length, appliedVersions };
}

// Clear in-flight flag when finished or on error
(function wrapClear() {
  const orig = runSqliteMigrations;
  (runSqliteMigrations as any) = async function (...args: any[]) {
    try {
      const res = await orig.apply(this, args);
      return res;
    } finally {
      (orig as any)._inFlight = false;
      (runSqliteMigrations as any)._inFlight = false;
    }
  };
})();

/**
 * Roll back migrations down to (but not including) targetVersion.
 * Runs in descending order.
 */
export async function rollbackSqliteMigrations(
  db: SQLite.SQLiteDatabase,
  migrations: SqliteMigration[],
  targetVersion: string,
): Promise<SqliteMigrationResult> {
  await ensureMigrationsTable(db);

  const applied = await getAppliedVersions(db);
  const toRollback = migrations
    .filter((m) => applied.has(m.version) && m.version > targetVersion)
    .sort((a, b) => b.version.localeCompare(a.version)); // descending

  if (toRollback.length === 0) {
    return { success: true, migrationsRun: 0, appliedVersions: [] };
  }

  const rolledBack: string[] = [];

  for (const migration of toRollback) {
    try {
      await db.withTransactionAsync(async () => {
        await migration.down(db);
        await recordRollback(db, migration.version);
      });
      rolledBack.push(migration.version);
    } catch (err) {
      return {
        success: false,
        migrationsRun: rolledBack.length,
        appliedVersions: rolledBack,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { success: true, migrationsRun: toRollback.length, appliedVersions: rolledBack };
}

/**
 * Returns the full migration history from schema_migrations.
 */
export async function getSqliteMigrationHistory(
  db: SQLite.SQLiteDatabase,
): Promise<SqliteMigrationRecord[]> {
  await ensureMigrationsTable(db);
  return db.getAllAsync<SqliteMigrationRecord>(
    `SELECT version, description, applied_at, status FROM schema_migrations ORDER BY version ASC`,
  );
}

export type ValidationSeverity = 'ok' | 'warn' | 'error';

export interface ValidationIssue {
  severity: ValidationSeverity;
  version: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate migration history on startup.
 *
 * - WARN: applied checksum doesn't match the bundled migration (file edited after apply)
 * - ERROR: a gap in the applied sequence exists (migration was skipped)
 */
export async function validateMigrations(
  db: SQLite.SQLiteDatabase,
  migrations: SqliteMigration[],
): Promise<ValidationResult> {
  await ensureMigrationsTable(db);

  const applied = await getAppliedVersions(db);
  const issues: ValidationIssue[] = [];

  const sorted = [...migrations].sort((a, b) => a.version.localeCompare(b.version));

  // Check for gaps: every migration before the last applied one should be applied
  const appliedVersionsSorted = [...applied.keys()].sort();
  const lastApplied = appliedVersionsSorted[appliedVersionsSorted.length - 1];

  for (const m of sorted) {
    if (!lastApplied || m.version > lastApplied) break; // not yet applied — not a gap

    if (!applied.has(m.version)) {
      issues.push({
        severity: 'error',
        version: m.version,
        message: `Migration ${m.version} was skipped — sequence gap detected.`,
      });
    } else {
      // Checksum mismatch check (empty checksum means pre-validation install — skip)
      const storedChecksum = applied.get(m.version)!;
      if (storedChecksum && storedChecksum !== m.checksum) {
        issues.push({
          severity: 'warn',
          version: m.version,
          message: `Checksum mismatch for ${m.version} — migration file may have been modified after it was applied.`,
        });
      }
    }
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}
