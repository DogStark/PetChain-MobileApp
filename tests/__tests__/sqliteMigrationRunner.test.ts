import * as SQLite from 'expo-sqlite';

import {
  runSqliteMigrations,
  rollbackSqliteMigrations,
  getSqliteMigrationHistory,
  validateMigrations,
  computeMigrationChecksum,
  type SqliteMigration,
} from '../../src/migrations/sqliteMigrationRunner';

const mockDb = SQLite.openDatabaseSync('petchain.db') as any;

function makeMigration(
  version: string,
  name: string,
  failUp = false,
  content = 'sql',
): SqliteMigration {
  return {
    version,
    description: name,
    checksum: computeMigrationChecksum(version, content),
    up: async (db) => {
      if (failUp) throw new Error('up failed');
      await db.execAsync(`CREATE TABLE IF NOT EXISTS t_${version} (id INTEGER PRIMARY KEY)`);
    },
    down: async (db) => {
      await db.execAsync(`DROP TABLE IF EXISTS t_${version}`);
    },
  };
}

describe('SQLite migration runner', () => {
  beforeEach(async () => {
    await mockDb.execAsync(`DROP TABLE IF EXISTS schema_migrations`);
  });

  test('applies migrations and records history', async () => {
    const m1 = makeMigration('20260101000001', 'create table 1');
    const m2 = makeMigration('20260101000002', 'create table 2');

    const res = await runSqliteMigrations(mockDb, [m1, m2]);
    expect(res.success).toBe(true);
    expect(res.migrationsRun).toBe(2);

    const history = await getSqliteMigrationHistory(mockDb);
    expect(history.map((h) => h.version)).toEqual(['20260101000001', '20260101000002']);
  });

  test('rollback migrations to target version', async () => {
    const m1 = makeMigration('20260101000001', 'create table 1');
    const m2 = makeMigration('20260101000002', 'create table 2');

    await runSqliteMigrations(mockDb, [m1, m2]);
    const res = await rollbackSqliteMigrations(mockDb, [m1, m2], '20260101000001');
    expect(res.success).toBe(true);
    expect(res.migrationsRun).toBe(1);
  });

  test('prevents duplicate execution when called concurrently', async () => {
    const m1 = makeMigration('20260101000001', 'create table 1');

    const [a, b] = await Promise.all([
      runSqliteMigrations(mockDb, [m1]),
      runSqliteMigrations(mockDb, [m1]),
    ]);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
  });

  test('recovers from failed migration by running down when possible', async () => {
    const good = makeMigration('20260101000001', 'good');
    const bad = makeMigration('20260101000002', 'bad', true);

    const res = await runSqliteMigrations(mockDb, [good, bad]);
    expect(res.success).toBe(false);
    const history = await getSqliteMigrationHistory(mockDb);
    expect(history.some((h) => h.version === '20260101000001')).toBe(true);
  });

  // ── validateMigrations ────────────────────────────────────────────────────

  test('validateMigrations: happy path — no issues', async () => {
    const m1 = makeMigration('20260101000001', 'table 1', false, 'sql1');
    const m2 = makeMigration('20260101000002', 'table 2', false, 'sql2');
    await runSqliteMigrations(mockDb, [m1, m2]);

    const result = await validateMigrations(mockDb, [m1, m2]);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('validateMigrations: detects sequence gap (skipped migration)', async () => {
    const m1 = makeMigration('20260101000001', 'table 1');
    const m2 = makeMigration('20260101000002', 'table 2');
    const m3 = makeMigration('20260101000003', 'table 3');

    // Apply m1 and m3, skipping m2
    await runSqliteMigrations(mockDb, [m1]);
    await runSqliteMigrations(mockDb, [m3]);

    const result = await validateMigrations(mockDb, [m1, m2, m3]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.severity === 'error' && i.version === '20260101000002'),
    ).toBe(true);
  });

  test('validateMigrations: warns on checksum mismatch', async () => {
    const m1 = makeMigration('20260101000001', 'table 1', false, 'original-sql');
    await runSqliteMigrations(mockDb, [m1]);

    // Simulate file edited after apply — different checksum
    const m1Edited = { ...m1, checksum: computeMigrationChecksum('20260101000001', 'edited-sql') };
    const result = await validateMigrations(mockDb, [m1Edited]);
    expect(result.valid).toBe(true); // mismatch is a WARN, not an ERROR
    expect(result.issues.some((i) => i.severity === 'warn' && i.version === '20260101000001')).toBe(
      true,
    );
  });
});
