/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

import { query, closePool } from './index';

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations/legacy');
const ROLLBACK_DIR = path.join(MIGRATIONS_DIR, 'rollback');

// Ordered list of all migration files
const MIGRATION_FILES = [
  '001_initial_schema.sql',
  '002_payment_schema.sql',
  '003_audit_log_schema.sql',
  '004_schema_enhancements.sql',
  '005_community_and_health_metrics.sql',
  '006_audit_trail.sql',
  '009_pet_weight.sql',
  '010_api_keys.sql',
  '20260528_create_forum_tables.sql',
];

async function ensureVersionTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedVersions(): Promise<Set<number>> {
  const result = await query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(result.rows.map((r: { version: number }) => r.version));
}

function versionFromFilename(filename: string): number {
  return parseInt(filename.split('_')[0], 10);
}

/** Run all pending migrations in order. */
export async function migrate(): Promise<void> {
  console.log('Starting database migrations...');

  try {
    await ensureVersionTable();
    const applied = await getAppliedVersions();

    for (const file of MIGRATION_FILES) {
      const version = versionFromFilename(file);
      if (applied.has(version)) {
        console.log(`  [skip] ${file} (already applied)`);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`  [run]  ${file}`);
      await query(sql);

      // Record version if the migration didn't insert it itself
      await query(
        `INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
        [version, file],
      );

      console.log(`  [done] ${file}`);
    }

    console.log('All migrations completed.');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    await closePool();
  }
}

/** Roll back to (but not including) targetVersion. */
export async function rollback(targetVersion: number): Promise<void> {
  console.log(`Rolling back to version ${targetVersion}...`);

  try {
    await ensureVersionTable();
    const applied = await getAppliedVersions();

    const toRollback = MIGRATION_FILES.filter(
      (f) => versionFromFilename(f) > targetVersion,
    ).reverse(); // descending order

    for (const file of toRollback) {
      const version = versionFromFilename(file);
      if (!applied.has(version)) {
        console.log(`  [skip] rollback ${file} (not applied)`);
        continue;
      }

      const rollbackFile = file.replace('.sql', '_rollback.sql');
      const rollbackPath = path.join(ROLLBACK_DIR, rollbackFile);

      if (!fs.existsSync(rollbackPath)) {
        throw new Error(`Rollback script not found: ${rollbackFile}`);
      }

      const sql = fs.readFileSync(rollbackPath, 'utf8');
      console.log(`  [rollback] ${rollbackFile}`);
      await query(sql);
      await query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      console.log(`  [done] rolled back ${file}`);
    }

    console.log(`Rollback to version ${targetVersion} complete.`);
  } catch (err) {
    console.error('Rollback failed:', err);
    throw err;
  } finally {
    await closePool();
  }
}

// CLI entry point: `ts-node migrate.ts [rollback <version>]`
if (require.main === module) {
  const [, , cmd, arg] = process.argv;

  if (cmd === 'rollback') {
    const target = parseInt(arg ?? '0', 10);
    rollback(target).catch(() => process.exit(1));
  } else {
    migrate().catch(() => process.exit(1));
  }
}
