import fs from 'fs';
import path from 'path';

import { closePool, query } from '../../../src/db';

export const VALID_HASH = 'a'.repeat(64);
export const VALID_TX_ID = 'b'.repeat(64);
export const MAINNET_TX_ID = 'c'.repeat(64);

export function shouldRunIntegrationTests(): boolean {
  return process.env.RUN_INTEGRATION_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
}

export async function ensureCheckpointTable(): Promise<void> {
  const migrationPath = path.join(
    __dirname,
    '../../../migrations/009_stellar_migration_checkpoints.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await query(sql);
}

export async function cleanupRun(runId: string): Promise<void> {
  await query('DELETE FROM stellar_migration_checkpoints WHERE migration_run_id = $1', [runId]);
}

export async function insertCheckpoint(input: {
  runId: string;
  recordId: string;
  userId: string;
  status?: string;
  mainnetTxId?: string;
  testnetHash?: string;
  testnetTxId?: string;
}): Promise<string> {
  const result = await query(
    `INSERT INTO stellar_migration_checkpoints
      (migration_run_id, record_id, user_id, testnet_tx_id, testnet_record_hash, status, mainnet_tx_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.runId,
      input.recordId,
      input.userId,
      input.testnetTxId ?? VALID_TX_ID,
      input.testnetHash ?? VALID_HASH,
      input.status ?? 'pending',
      input.mainnetTxId ?? null,
    ],
  );

  return String(result.rows[0].id);
}

export async function getCheckpoint(recordId: string, runId: string) {
  const result = await query(
    `SELECT status, mainnet_tx_id, error_message
     FROM stellar_migration_checkpoints
     WHERE migration_run_id = $1 AND record_id = $2`,
    [runId, recordId],
  );
  return result.rows[0] as
    | { status: string; mainnet_tx_id: string | null; error_message: string | null }
    | undefined;
}

export async function shutdownDatabase(): Promise<void> {
  await closePool();
}
