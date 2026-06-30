import path from 'path';

import { runner } from 'node-pg-migrate';
import { Client } from 'pg';

async function waitForPostgres(connectionString: string, retries = 10) {
  for (let i = 0; i < retries; i++) {
    const client = new Client({ connectionString });
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

async function main() {
  const DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
  const baseClient = new Client({ connectionString: DATABASE_URL });

  console.log('[validate] Waiting for Postgres...');
  await waitForPostgres(DATABASE_URL, 30);

  const testDbName = `petchain_migration_check_${Date.now()}`;
  console.log(`[validate] Creating temporary DB ${testDbName}`);

  await baseClient.connect();
  await baseClient.query(`CREATE DATABASE ${testDbName}`);
  await baseClient.end();

  const testDbUrl = (() => {
    const u = new URL(DATABASE_URL);
    u.pathname = `/${testDbName}`;
    return u.toString();
  })();

  const migrationsDir = path.resolve(__dirname, '..', 'backend', 'migrations');

  console.log('[validate] Running migrations UP on temporary DB');
  await runner({
    databaseUrl: testDbUrl,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'schema_migrations',
    log: (m: string) => console.log('[validate:migrate]', m),
  });

  console.log('[validate] Rolling back migrations (DOWN) on temporary DB');
  // Rollback everything: run down repeatedly until zero applied. node-pg-migrate supports count, but
  // we don't know count; running with direction 'down' without count rolls back all when using CLI,
  // so we'll attempt to call with a large count to force full rollback.
  await runner({
    databaseUrl: testDbUrl,
    dir: migrationsDir,
    direction: 'down',
    count: 1000,
    migrationsTable: 'schema_migrations',
    log: (m: string) => console.log('[validate:rollback]', m),
  });

  console.log('[validate] Dropping temporary DB');
  const dropClient = new Client({ connectionString: DATABASE_URL });
  await dropClient.connect();
  // Terminate connections to the test DB (safer drop)
  await dropClient.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${testDbName}'`,
  );
  await dropClient.query(`DROP DATABASE IF EXISTS ${testDbName}`);
  await dropClient.end();

  console.log('[validate] Migration validation completed successfully');
}

main().catch((err) => {
  console.error('[validate] Migration validation failed:', err);
  process.exit(1);
});
