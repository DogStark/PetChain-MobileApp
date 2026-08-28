import m20260101000001 from './scripts/20260101000001_baseline_schema';
import m20260101000002 from './scripts/20260101000002_medication_fields';
import m20260527000001 from './scripts/20260527000001_health_thresholds';
import type { SqliteMigration } from './sqliteMigrationRunner';

/**
 * All SQLite migrations in ascending version order.
 * Add new migrations here — order is enforced by the runner.
 */
export const ALL_SQLITE_MIGRATIONS: SqliteMigration[] = [
  m20260101000001,
  m20260101000002,
  m20260527000001,
];

export {
  runSqliteMigrations,
  rollbackSqliteMigrations,
  getSqliteMigrationHistory,
  validateMigrations,
  computeMigrationChecksum,
} from './sqliteMigrationRunner';
