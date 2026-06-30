import fs from 'fs';
import path from 'path';

import { Client } from 'pg';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'backend', 'migrations', 'legacy');
const ROLLBACK_DIR = path.resolve(MIGRATIONS_DIR, 'rollback');
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

async function waitForPostgres(retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Postgres did not become ready in time');
}

async function runFile(client: Client, filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf-8');
  await client.query(sql);
}

async function getSchemaFingerprint(client: Client): Promise<string> {
  const res = await client.query<Record<string, string>>(`
    SELECT
      t.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_name = t.table_name
     AND c.table_schema = t.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position
  `);
  return JSON.stringify(res.rows);
}

function numericPrefix(filename: string): string {
  return filename.match(/^(\d+)/)?.[1] ?? '';
}

async function main(): Promise<void> {
  console.log('[test:migrations] Waiting for Postgres...');
  await waitForPostgres();

  const baseClient = new Client({ connectionString: DATABASE_URL });
  await baseClient.connect();
  const testDbName = `petchain_rollback_test_${Date.now()}`;
  console.log(`[test:migrations] Creating temporary DB: ${testDbName}`);
  await baseClient.query(`CREATE DATABASE ${testDbName}`);
  await baseClient.end();

  const testDbUrl = (() => {
    const u = new URL(DATABASE_URL);
    u.pathname = `/${testDbName}`;
    return u.toString();
  })();

  const testClient = new Client({ connectionString: testDbUrl });
  await testClient.connect();

  // Forward migration files in the legacy folder, sorted numerically
  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && /^\d+_/.test(f))
    .sort();

  // Index rollback files by their numeric prefix
  const rollbackByPrefix = new Map<string, string>();
  for (const f of fs.readdirSync(ROLLBACK_DIR)) {
    if (f.endsWith('.sql')) {
      const prefix = numericPrefix(f);
      if (prefix) rollbackByPrefix.set(prefix, path.join(ROLLBACK_DIR, f));
    }
  }

  let passed = 0;
  let warnings = 0;
  let failed = 0;

  for (const migFile of migrationFiles) {
    const migPath = path.join(MIGRATIONS_DIR, migFile);
    const prefix = numericPrefix(migFile);
    const rollbackPath = rollbackByPrefix.get(prefix);

    console.log(`\n[test:migrations] ── ${migFile}`);

    try {
      await runFile(testClient, migPath);
      console.log('  ✓ Applied');
    } catch (err) {
      console.error(`  ✗ Failed to apply: ${err}`);
      failed++;
      continue;
    }

    if (!rollbackPath) {
      console.warn(`  ⚠  No rollback file for prefix ${prefix} — skipping rollback test`);
      warnings++;
      continue;
    }

    const schemaAfterApply = await getSchemaFingerprint(testClient);

    try {
      await runFile(testClient, rollbackPath);
      console.log('  ✓ Rolled back');
    } catch (err) {
      console.error(`  ✗ Failed to roll back: ${err}`);
      failed++;
      continue;
    }

    try {
      await runFile(testClient, migPath);
      console.log('  ✓ Re-applied');
    } catch (err) {
      console.error(`  ✗ Failed to re-apply: ${err}`);
      failed++;
      continue;
    }

    const schemaAfterReapply = await getSchemaFingerprint(testClient);
    if (schemaAfterApply === schemaAfterReapply) {
      console.log('  ✓ Schema verified');
      passed++;
    } else {
      console.error('  ✗ Schema mismatch after rollback + re-apply');
      failed++;
    }
  }

  await testClient.end();

  const cleanupClient = new Client({ connectionString: DATABASE_URL });
  await cleanupClient.connect();
  await cleanupClient.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${testDbName}'`,
  );
  await cleanupClient.query(`DROP DATABASE IF EXISTS ${testDbName}`);
  await cleanupClient.end();

  console.log(
    `\n[test:migrations] Results: ${passed} passed, ${warnings} warnings (no rollback), ${failed} failed`,
  );

  if (warnings > 0) {
    console.warn(
      `[test:migrations] ${warnings} migration(s) have no rollback script and were not tested`,
    );
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[test:migrations] Fatal error:', err);
  process.exit(1);
});
