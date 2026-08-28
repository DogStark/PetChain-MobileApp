/**
 * Migration tests for every production database schema (issue #993).
 *
 * PetChain ships two independently-versioned schemas:
 *  - Postgres backend schema, migrated with node-pg-migrate from `backend/migrations`
 *    (plus a `legacy/` tree of pre-node-pg-migrate SQL + hand-written rollbacks).
 *  - On-device SQLite schema, migrated by `src/migrations/sqliteMigrationRunner.ts`
 *    using the ordered list in `src/migrations/index.ts`.
 *
 * This suite validates uniqueness of migration identifiers, round-trips the
 * real production SQLite migrations (up -> down -> up), and characterizes
 * known ordering/rollback gaps in the Postgres migration tree so any new
 * regression is caught instead of silently growing.
 */
import fs from 'fs';
import path from 'path';

import * as SQLite from 'expo-sqlite';

import {
  ALL_SQLITE_MIGRATIONS,
  runSqliteMigrations,
  rollbackSqliteMigrations,
  getSqliteMigrationHistory,
  validateMigrations,
} from '../../src/migrations';

const BACKEND_MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/migrations');
const BACKEND_ROLLBACK_DIR = path.join(BACKEND_MIGRATIONS_DIR, 'rollback');
const LEGACY_MIGRATIONS_DIR = path.join(BACKEND_MIGRATIONS_DIR, 'legacy');
const LEGACY_ROLLBACK_DIR = path.join(LEGACY_MIGRATIONS_DIR, 'rollback');

function listSqlFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function numericPrefix(filename: string): string {
  return filename.match(/^(\d+)/)?.[1] ?? '';
}

function groupByPrefix(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const prefix = numericPrefix(file);
    const list = groups.get(prefix) ?? [];
    list.push(file);
    groups.set(prefix, list);
  }
  return groups;
}

describe('Postgres production migrations (backend/migrations) — file integrity', () => {
  // "Current" migrations = top-level *.sql files, excluding the legacy/ and rollback/ subtrees.
  const currentFiles = listSqlFiles(BACKEND_MIGRATIONS_DIR);

  test('every current migration file follows the numeric-or-timestamp naming convention', () => {
    expect(currentFiles.length).toBeGreaterThan(0);
    for (const file of currentFiles) {
      expect(file).toMatch(/^\d+_[a-zA-Z0-9_]+\.sql$/);
    }
  });

  test('no two current migration files share an identical full identifier', () => {
    const stems = currentFiles.map((f) => f.replace(/\.sql$/, ''));
    expect(new Set(stems).size).toBe(stems.length);
  });

  test('characterizes known duplicate ordering prefixes so new collisions fail the build', () => {
    // node-pg-migrate orders migrations by full filename, not by numeric prefix alone, so a
    // duplicated prefix doesn't break `npm run migrate` — but it does mean two migrations run
    // in an alphabetical order that has nothing to do with when they were authored, which is
    // exactly the "ordering and rollback risk" called out in issue #993.
    //
    // These two collisions are tracked debt, not this change's responsibility to renumber
    // (renumbering already-applied production migrations is its own risky change). This test
    // exists so nobody introduces a *third* collision without noticing.
    const duplicateGroups = [...groupByPrefix(currentFiles).entries()]
      .filter(([, files]) => files.length > 1)
      .sort(([a], [b]) => a.localeCompare(b));

    expect(duplicateGroups).toEqual([
      [
        '009',
        [
          '009_family_sharing.sql',
          '009_hipaa_audit_compliance.sql',
          '009_pet_weight.sql',
          '009_stellar_migration_checkpoints.sql',
          '009_two_factor_auth.sql',
          '009_vitals_timeseries.sql',
        ],
      ],
      [
        '20260627000001000',
        ['20260627000001000_qr_tokens.sql', '20260627000001000_users_preferred_language.sql'],
      ],
    ]);
  });

  test('every current migration file is non-empty and contains a schema statement', () => {
    for (const file of currentFiles) {
      const sql = fs.readFileSync(path.join(BACKEND_MIGRATIONS_DIR, file), 'utf8').trim();
      expect(sql.length).toBeGreaterThan(0);
      expect(sql.toUpperCase()).toMatch(/CREATE|ALTER|INSERT|DROP/);
    }
  });

  test('current-tree rollback scripts target files that still exist', () => {
    if (!fs.existsSync(BACKEND_ROLLBACK_DIR)) return;
    const rollbackFiles = listSqlFiles(BACKEND_ROLLBACK_DIR);
    const currentPrefixes = new Set(currentFiles.map(numericPrefix));
    for (const rollback of rollbackFiles) {
      expect(currentPrefixes.has(numericPrefix(rollback))).toBe(true);
    }
  });
});

describe('Postgres legacy migrations (backend/migrations/legacy) — round-trip coverage', () => {
  const legacyFiles = listSqlFiles(LEGACY_MIGRATIONS_DIR);
  const rollbackFiles = listSqlFiles(LEGACY_ROLLBACK_DIR);
  const rollbackPrefixes = new Set(rollbackFiles.map(numericPrefix));

  test('legacy migration files are present and uniquely prefixed', () => {
    expect(legacyFiles.length).toBeGreaterThan(0);
    const prefixes = legacyFiles.map(numericPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  test('characterizes which legacy migrations are missing a rollback script', () => {
    // A migration with no rollback script can't be part of the round-trip (up -> down -> up)
    // validation `scripts/test-migrations.ts` performs against a live Postgres instance, and
    // can't be safely reverted in production if it needs to be. This is real, existing gap —
    // tracked here explicitly rather than fixed blind, since writing a correct rollback for
    // 007_gdpr_ccpa / 008_insurance requires domain review of what's safe to undo.
    const missingRollback = legacyFiles.filter((f) => !rollbackPrefixes.has(numericPrefix(f)));
    expect(missingRollback).toEqual(['007_gdpr_ccpa.sql', '008_insurance.sql']);
  });

  test('legacy migrations that do have a rollback script are non-empty and reference SQL', () => {
    const coveredPrefixes = legacyFiles
      .map(numericPrefix)
      .filter((prefix) => rollbackPrefixes.has(prefix));

    for (const prefix of coveredPrefixes) {
      const rollbackFile = rollbackFiles.find((f) => numericPrefix(f) === prefix);
      expect(rollbackFile).toBeDefined();
      const sql = fs.readFileSync(path.join(LEGACY_ROLLBACK_DIR, rollbackFile!), 'utf8').trim();
      expect(sql.length).toBeGreaterThan(0);
      expect(sql.toUpperCase()).toMatch(/DROP|ALTER|DELETE/);
    }
  });
});

describe('SQLite production migrations (src/migrations) — round-trip on the real schema', () => {
  const mockDb = SQLite.openDatabaseSync('petchain.db') as any;

  beforeEach(async () => {
    await mockDb.execAsync('DROP TABLE IF EXISTS schema_migrations');
  });

  test('migration versions are unique and sorted ascending, as index.ts documents', () => {
    const versions = ALL_SQLITE_MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) => a.localeCompare(b));
    expect(versions).toEqual(sorted);
  });

  test('applying every production migration succeeds and records full history', async () => {
    const result = await runSqliteMigrations(mockDb, ALL_SQLITE_MIGRATIONS);
    expect(result.success).toBe(true);
    expect(result.migrationsRun).toBe(ALL_SQLITE_MIGRATIONS.length);

    const history = await getSqliteMigrationHistory(mockDb);
    expect(history.map((h) => h.version)).toEqual(ALL_SQLITE_MIGRATIONS.map((m) => m.version));
    expect(history.every((h) => h.status === 'applied')).toBe(true);
  });

  test('round-trips the full production schema: up -> down -> up', async () => {
    const up1 = await runSqliteMigrations(mockDb, ALL_SQLITE_MIGRATIONS);
    expect(up1.success).toBe(true);

    const firstVersion = ALL_SQLITE_MIGRATIONS[0].version;
    // Roll back everything by targeting a version older than the first migration.
    const down = await rollbackSqliteMigrations(mockDb, ALL_SQLITE_MIGRATIONS, '0');
    expect(down.success).toBe(true);
    expect(down.migrationsRun).toBe(ALL_SQLITE_MIGRATIONS.length);

    const historyAfterRollback = await getSqliteMigrationHistory(mockDb);
    expect(historyAfterRollback.every((h) => h.status === 'rolled_back')).toBe(true);

    const up2 = await runSqliteMigrations(mockDb, ALL_SQLITE_MIGRATIONS);
    expect(up2.success).toBe(true);
    expect(up2.migrationsRun).toBe(ALL_SQLITE_MIGRATIONS.length);

    const historyAfterReapply = await getSqliteMigrationHistory(mockDb);
    expect(historyAfterReapply.every((h) => h.status === 'applied')).toBe(true);
    expect(firstVersion).toBe(ALL_SQLITE_MIGRATIONS[0].version);
  });

  test('validateMigrations reports no issues against a freshly-applied production schema', async () => {
    await runSqliteMigrations(mockDb, ALL_SQLITE_MIGRATIONS);
    const result = await validateMigrations(mockDb, ALL_SQLITE_MIGRATIONS);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });
});
