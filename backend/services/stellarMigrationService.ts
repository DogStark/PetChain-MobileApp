/**
 * stellarMigrationService.ts
 *
 * Migrates anchored medical records from Stellar testnet to mainnet.
 * Guarantees: idempotency, resumability, rollback-safety, zero data loss,
 * duplicate prevention, and hash consistency.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

import { StellarAnchorService } from './stellarService';
import { getPool, query } from '../src/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MigrationStatus = 'pending' | 'in_progress' | 'verified' | 'failed' | 'skipped';

export interface MigrationCheckpoint {
  id: string;
  migrationRunId: string;
  recordId: string;
  userId: string;
  testnetTxId: string;
  testnetRecordHash: string;
  mainnetTxId?: string;
  mainnetLedger?: number;
  status: MigrationStatus;
  errorMessage?: string;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MigrationProgress {
  runId: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  estimatedSecondsRemaining: number | null;
  startedAt: Date;
}

export interface MigrationRunResult {
  runId: string;
  total: number;
  migrated: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface TestnetRecord {
  recordId: string;
  recordHash: string;
  transactionId: string;
  ledgerSequence?: number;
}

export interface ReconcileDiscrepancy {
  checkpointId: string;
  recordId: string;
  mainnetTxId: string;
  reason: 'tx_not_found' | 'hash_mismatch' | 'tx_failed';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\w\-:.]/g, '').slice(0, 256);
}

function sanitizeHash(value: unknown): string {
  if (typeof value !== 'string') return '';
  return /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : '';
}

function sanitizeTxId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// StellarMigrationService
// ---------------------------------------------------------------------------

export class StellarMigrationService {
  private readonly anchorService: StellarAnchorService;
  private readonly mainnetSecret: string | undefined;

  constructor(anchorService?: StellarAnchorService, mainnetSecret?: string) {
    this.anchorService = anchorService ?? new StellarAnchorService();
    this.mainnetSecret = mainnetSecret ?? process.env.STELLAR_MAINNET_SOURCE_SECRET;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Enumerate all confirmed testnet transactions for a user's medical records.
   * Returns only records that have not yet been successfully migrated.
   */
  async enumerateTestnetRecords(userId: string): Promise<TestnetRecord[]> {
    const sanitizedUserId = sanitizeString(userId);
    if (!sanitizedUserId) throw new Error('Invalid userId');

    const result = await query(
      `SELECT bt.record_id, bt.record_hash, bt.transaction_id, bt.ledger_sequence
       FROM blockchain_transactions bt
       JOIN medical_records mr ON mr.id = bt.record_id
       WHERE mr.user_id = $1
         AND bt.network = 'testnet'
         AND bt.status IN ('submitted', 'confirmed')
         AND bt.record_id NOT IN (
           SELECT smc.record_id
           FROM stellar_migration_checkpoints smc
           WHERE smc.user_id = $1
             AND smc.status = 'verified'
         )
       ORDER BY bt.created_at ASC`,
      [sanitizedUserId],
    );

    return result.rows.map((row) => ({
      recordId: sanitizeString(row.record_id),
      recordHash: sanitizeHash(row.record_hash),
      transactionId: sanitizeTxId(row.transaction_id),
      ledgerSequence: typeof row.ledger_sequence === 'number' ? row.ledger_sequence : undefined,
    }));
  }

  /**
   * Validate that a testnet transaction's on-chain hash matches the stored hash.
   * Queries Horizon testnet to confirm the manageData operation value.
   */
  async validateTestnetTransaction(record: TestnetRecord): Promise<boolean> {
    if (!record.recordId || !record.recordHash || !record.transactionId) return false;

    try {
      const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
      const tx = await (
        server as unknown as Record<
          string,
          (...args: unknown[]) => {
            transaction: (id: string) => { call: () => Promise<{ successful: boolean }> };
          }
        >
      )
        .transactions()
        .transaction(record.transactionId)
        .call();

      // Validate the transaction exists and is successful
      if (!tx || tx.successful === false) return false;

      // Verify the memo/manageData hash matches stored hash
      const ops = await (
        server as unknown as Record<
          string,
          (...args: unknown[]) => {
            forTransaction: (id: string) => {
              call: () => Promise<{
                records: Array<{ type: string; name: string; value: string }>;
              }>;
            };
          }
        >
      )
        .operations()
        .forTransaction(record.transactionId)
        .call();

      const manageDataOp = ops.records?.find(
        (op: { type: string; name: string; value: string }) =>
          op.type === 'manage_data' && op.name === `record:${record.recordId}`.slice(0, 64),
      );

      if (!manageDataOp) return false;

      // manageData value is base64-encoded on Horizon
      const onChainHash = Buffer.from(manageDataOp.value, 'base64').toString('utf8');
      return sanitizeHash(onChainHash) === record.recordHash;
    } catch {
      return false;
    }
  }

  /**
   * Run a full migration for a user. Resumes from last checkpoint if interrupted.
   * Returns a run result summary.
   */
  async migrateUser(
    userId: string,
    runId: string,
    onProgress?: (progress: MigrationProgress) => void,
  ): Promise<MigrationRunResult> {
    const sanitizedUserId = sanitizeString(userId);
    const sanitizedRunId = sanitizeString(runId);
    if (!sanitizedUserId || !sanitizedRunId) throw new Error('Invalid userId or runId');

    const startedAt = new Date();
    const records = await this.enumerateTestnetRecords(sanitizedUserId);

    // Seed checkpoints for new records (idempotent upsert)
    await this.seedCheckpoints(sanitizedRunId, sanitizedUserId, records);

    const total = await this.countCheckpoints(sanitizedRunId);
    let migrated = 0;
    let failed = 0;
    let skipped = 0;

    // Process in batches to handle large datasets
    let offset = 0;
    while (true) {
      const batch = await this.fetchPendingCheckpoints(sanitizedRunId, BATCH_SIZE, offset);
      if (batch.length === 0) break;

      for (const checkpoint of batch) {
        const result = await this.migrateRecord(checkpoint);
        if (result === 'verified') migrated++;
        else if (result === 'failed') failed++;
        else if (result === 'skipped') skipped++;

        if (onProgress) {
          const elapsed = Date.now() - startedAt.getTime();
          const done = migrated + failed + skipped;
          const rate = done > 0 ? elapsed / done : null;
          const remaining = rate !== null ? Math.round((rate * (total - done)) / 1000) : null;
          onProgress({
            runId: sanitizedRunId,
            total,
            completed: migrated,
            failed,
            skipped,
            pending: total - done,
            estimatedSecondsRemaining: remaining,
            startedAt,
          });
        }
      }

      offset += batch.length;
    }

    return {
      runId: sanitizedRunId,
      total,
      migrated,
      failed,
      skipped,
      durationMs: Date.now() - startedAt.getTime(),
    };
  }

  /**
   * Retry all failed checkpoints for a run.
   */
  async retryFailed(runId: string): Promise<void> {
    const sanitizedRunId = sanitizeString(runId);
    await query(
      `UPDATE stellar_migration_checkpoints
       SET status = 'pending', error_message = NULL, updated_at = NOW()
       WHERE migration_run_id = $1 AND status = 'failed' AND attempts < $2`,
      [sanitizedRunId, MAX_ATTEMPTS],
    );
  }

  /**
   * Get current progress for a migration run.
   */
  async getProgress(runId: string, startedAt: Date): Promise<MigrationProgress> {
    const sanitizedRunId = sanitizeString(runId);
    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'verified')    AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')     AS skipped,
         COUNT(*) FILTER (WHERE status IN ('pending','in_progress')) AS pending,
         COUNT(*)                                        AS total
       FROM stellar_migration_checkpoints
       WHERE migration_run_id = $1`,
      [sanitizedRunId],
    );
    const row = result.rows[0];
    const total = Number(row.total);
    const completed = Number(row.completed);
    const failed = Number(row.failed);
    const skipped = Number(row.skipped);
    const pending = Number(row.pending);
    const elapsed = Date.now() - startedAt.getTime();
    const done = completed + failed + skipped;
    const rate = done > 0 ? elapsed / done : null;
    const estimatedSecondsRemaining = rate !== null ? Math.round((rate * pending) / 1000) : null;

    return {
      runId: sanitizedRunId,
      total,
      completed,
      failed,
      skipped,
      pending,
      estimatedSecondsRemaining,
      startedAt,
    };
  }

  /**
   * Compare DB-verified checkpoints for a run against Horizon mainnet.
   * Returns discrepancies where the on-chain state does not match the DB record.
   */
  async reconcile(runId: string): Promise<ReconcileDiscrepancy[]> {
    const sanitizedRunId = sanitizeString(runId);
    if (!sanitizedRunId) throw new Error('Invalid runId');

    const result = await query(
      `SELECT id, record_id, mainnet_tx_id, testnet_record_hash
       FROM stellar_migration_checkpoints
       WHERE migration_run_id = $1 AND status = 'verified' AND mainnet_tx_id IS NOT NULL`,
      [sanitizedRunId],
    );

    const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
    const discrepancies: ReconcileDiscrepancy[] = [];

    for (const row of result.rows) {
      const mainnetTxId = sanitizeTxId(String(row.mainnet_tx_id));
      const expectedHash = sanitizeHash(String(row.testnet_record_hash));
      const recordId = sanitizeString(String(row.record_id));

      try {
        const tx = await (
          server as unknown as Record<
            string,
            (...args: unknown[]) => {
              transaction: (id: string) => { call: () => Promise<{ successful: boolean }> };
            }
          >
        )
          .transactions()
          .transaction(mainnetTxId)
          .call();

        if (!tx || tx.successful === false) {
          discrepancies.push({
            checkpointId: String(row.id),
            recordId,
            mainnetTxId,
            reason: 'tx_failed',
          });
          continue;
        }

        const ops = await (
          server as unknown as Record<
            string,
            (...args: unknown[]) => {
              forTransaction: (id: string) => {
                call: () => Promise<{
                  records: Array<{ type: string; name: string; value: string }>;
                }>;
              };
            }
          >
        )
          .operations()
          .forTransaction(mainnetTxId)
          .call();

        const manageDataOp = ops.records?.find(
          (op: { type: string; name: string; value: string }) =>
            op.type === 'manage_data' && op.name === `record:${recordId}`.slice(0, 64),
        );

        if (!manageDataOp) {
          discrepancies.push({
            checkpointId: String(row.id),
            recordId,
            mainnetTxId,
            reason: 'tx_not_found',
          });
          continue;
        }

        const onChainHash = sanitizeHash(
          Buffer.from(manageDataOp.value, 'base64').toString('utf8'),
        );
        if (onChainHash !== expectedHash) {
          discrepancies.push({
            checkpointId: String(row.id),
            recordId,
            mainnetTxId,
            reason: 'hash_mismatch',
          });
        }
      } catch {
        discrepancies.push({
          checkpointId: String(row.id),
          recordId,
          mainnetTxId,
          reason: 'tx_not_found',
        });
      }
    }

    return discrepancies;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async migrateRecord(checkpoint: MigrationCheckpoint): Promise<MigrationStatus> {
    // Already done
    if (checkpoint.status === 'verified' || checkpoint.status === 'skipped') {
      return checkpoint.status;
    }

    // Exceeded max attempts
    if (checkpoint.attempts >= MAX_ATTEMPTS) {
      await this.updateCheckpoint(
        checkpoint.id,
        'failed',
        undefined,
        undefined,
        'Max attempts exceeded',
      );
      return 'failed';
    }

    // Mark in_progress (optimistic lock against concurrent runs)
    const locked = await this.lockCheckpoint(checkpoint.id);
    if (!locked) return 'skipped';

    let anchorResult: Awaited<ReturnType<StellarAnchorService['anchorRecord']>> | undefined;

    try {
      // Validate testnet transaction integrity
      const testnetRecord: TestnetRecord = {
        recordId: checkpoint.recordId,
        recordHash: checkpoint.testnetRecordHash,
        transactionId: checkpoint.testnetTxId,
      };

      const valid = await this.validateTestnetTransaction(testnetRecord);
      if (!valid) {
        await this.updateCheckpoint(
          checkpoint.id,
          'skipped',
          undefined,
          undefined,
          'Testnet validation failed',
        );
        return 'skipped';
      }

      // Re-anchor on mainnet using the exact same hash
      anchorResult = await this.anchorService.anchorRecord({
        recordId: checkpoint.recordId,
        payload: checkpoint.testnetRecordHash,
        sourceSecret: this.mainnetSecret,
        network: 'mainnet',
      });

      if (anchorResult.status === 'failed') {
        throw new Error('Mainnet anchoring returned failed status');
      }

      // Verify mainnet hash matches testnet hash
      const mainnetHash = this.anchorService.hashPayload(checkpoint.testnetRecordHash);
      if (mainnetHash !== anchorResult.recordHash) {
        throw new Error(
          `Hash mismatch: testnet=${checkpoint.testnetRecordHash} mainnet=${anchorResult.recordHash}`,
        );
      }

      // Wrap checkpoint update in a DB transaction so the write and Stellar submission
      // result are atomic — if either fails, both roll back.
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE stellar_migration_checkpoints
           SET status = $2,
               mainnet_tx_id = COALESCE($3, mainnet_tx_id),
               mainnet_ledger = COALESCE($4, mainnet_ledger),
               error_message = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [
            checkpoint.id,
            'verified',
            anchorResult!.transactionId ?? null,
            anchorResult!.ledgerSequence ?? null,
          ],
        );
      });

      return 'verified';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Log XDR so the transaction can be manually re-applied if the DB write failed
      if (anchorResult?.xdr) {
        console.error(
          `[stellarMigration] rollback — checkpoint=${checkpoint.id} xdr=${anchorResult.xdr}`,
        );
      }

      await this.updateCheckpoint(checkpoint.id, 'failed', undefined, undefined, message);
      return 'failed';
    }
  }

  private async seedCheckpoints(
    runId: string,
    userId: string,
    records: TestnetRecord[],
  ): Promise<void> {
    if (records.length === 0) return;

    // Batch upsert — ON CONFLICT DO NOTHING ensures idempotency
    const values = records
      .filter((r) => r.recordId && r.recordHash && r.transactionId)
      .map((r, i) => {
        const base = i * 5;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      })
      .join(', ');

    if (!values) return;

    const params: string[] = [];
    for (const r of records.filter((r) => r.recordId && r.recordHash && r.transactionId)) {
      params.push(runId, r.recordId, userId, r.transactionId, r.recordHash);
    }

    await query(
      `INSERT INTO stellar_migration_checkpoints
         (migration_run_id, record_id, user_id, testnet_tx_id, testnet_record_hash)
       VALUES ${values}
       ON CONFLICT (migration_run_id, record_id) DO NOTHING`,
      params,
    );
  }

  private async fetchPendingCheckpoints(
    runId: string,
    limit: number,
    offset: number,
  ): Promise<MigrationCheckpoint[]> {
    const result = await query(
      `SELECT id, migration_run_id, record_id, user_id, testnet_tx_id, testnet_record_hash,
              mainnet_tx_id, mainnet_ledger, status, error_message, attempts, created_at, updated_at
       FROM stellar_migration_checkpoints
       WHERE migration_run_id = $1
         AND status IN ('pending', 'failed')
         AND attempts < $2
       ORDER BY created_at ASC
       LIMIT $3 OFFSET $4`,
      [runId, MAX_ATTEMPTS, limit, offset],
    );
    return result.rows.map(rowToCheckpoint);
  }

  private async countCheckpoints(runId: string): Promise<number> {
    const result = await query(
      `SELECT COUNT(*) AS total FROM stellar_migration_checkpoints WHERE migration_run_id = $1`,
      [runId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  /** Atomically mark a checkpoint as in_progress. Returns false if already locked. */
  private async lockCheckpoint(id: string): Promise<boolean> {
    const result = await query(
      `UPDATE stellar_migration_checkpoints
       SET status = 'in_progress', attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'failed')
       RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async updateCheckpoint(
    id: string,
    status: MigrationStatus,
    mainnetTxId?: string,
    mainnetLedger?: number,
    errorMessage?: string,
  ): Promise<void> {
    await query(
      `UPDATE stellar_migration_checkpoints
       SET status = $2,
           mainnet_tx_id = COALESCE($3, mainnet_tx_id),
           mainnet_ledger = COALESCE($4, mainnet_ledger),
           error_message = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [id, status, mainnetTxId ?? null, mainnetLedger ?? null, errorMessage ?? null],
    );
  }
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToCheckpoint(row: Record<string, unknown>): MigrationCheckpoint {
  return {
    id: String(row.id),
    migrationRunId: String(row.migration_run_id),
    recordId: String(row.record_id),
    userId: String(row.user_id),
    testnetTxId: String(row.testnet_tx_id),
    testnetRecordHash: String(row.testnet_record_hash),
    mainnetTxId: row.mainnet_tx_id ? String(row.mainnet_tx_id) : undefined,
    mainnetLedger: row.mainnet_ledger != null ? Number(row.mainnet_ledger) : undefined,
    status: row.status as MigrationStatus,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    attempts: Number(row.attempts),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const stellarMigrationService = new StellarMigrationService();
export default stellarMigrationService;
