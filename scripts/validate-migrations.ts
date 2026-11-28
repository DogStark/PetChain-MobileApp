import fs from 'fs';
import path from 'path';

import { runner } from 'node-pg-migrate';
import { Client } from 'pg';

const ROLLBACK_DIR = path.resolve(__dirname, '..', 'backend', 'migrations', 'rollback');

interface RollbackFile {
  name: string;
  filePath: string;
}

function parseStepsArg(argv: string[]): number {
  const idx = argv.findIndex((a) => a === '--steps' || a.startsWith('--steps='));
  if (idx === -1) return 1;

  const arg = argv[idx];
  const raw = arg.includes('=') ? arg.split('=')[1] : argv[idx + 1];
  const steps = Number.parseInt(raw ?? '', 10);

  if (!Number.isFinite(steps) || steps <= 0) {
    throw new Error(`Invalid --steps value: ${raw}`);
  }
  return steps;
}

function discoverRollbackFiles(): RollbackFile[] {
  if (!fs.existsSync(ROLLBACK_DIR)) {
    return [];
  }

  return fs
    .readdirSync(ROLLBACK_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, filePath: path.join(ROLLBACK_DIR, name) }));
}

async function getCurrentVersion(client: Client): Promise<string | null> {
  const { rows } = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY run_on DESC, id DESC LIMIT 1',
  );
  return rows.length > 0 ? rows[0].name : null;
}

export async function runRollbackMigrations(
  databaseUrl: string,
  steps: number,
  log: (msg: string) => void = (m) => console.log('[rollback]', m),
): Promise<void> {
  const files = discoverRollbackFiles();
  if (files.length === 0) {
    throw new Error(`No rollback SQL files found in ${ROLLBACK_DIR}`);
  }

  const toApply = files.slice(-steps).reverse();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    for (const rollback of toApply) {
      if (!fs.existsSync(rollback.filePath)) {
        throw new Error(`Rollback SQL missing: ${rollback.filePath}`);
      }

      const sql = fs.readFileSync(rollback.filePath, 'utf8');
      if (!sql.trim()) {
        throw new Error(`Rollback SQL is empty: ${rollback.filePath}`);
      }

      const beforeVersion = await getCurrentVersion(client);

      log(`Applying rollback ${rollback.name} (before: ${beforeVersion ?? 'none'})`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        log(`Rollback failed for ${rollback.name}; transaction rolled back`);
        throw err;
      }

      const afterVersion = await getCurrentVersion(client);
      log(
        `Applied rollback ${rollback.name} (before: ${beforeVersion ?? 'none'}, after: ${
          afterVersion ?? 'none'
        })`,
      );
    }
  } finally {
    await client.end();
  }
}

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

  if (process.argv.includes('--rollback')) {
    const steps = parseStepsArg(process.argv);
    console.log(`[rollback] Rolling back ${steps} migration(s)...`);
    await runRollbackMigrations(DATABASE_URL, steps);
    console.log('[rollback] Rollback completed successfully');
    return;
  }

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

if (require.main === module) {
  main().catch((err) => {
    console.error('[validate] Migration validation failed:', err);
    process.exit(1);
  });
}
