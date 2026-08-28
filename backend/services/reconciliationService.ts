/**
 * Reconciliation Service
 * Issue #102 — Automated Vet Record Reconciliation
 *
 * Periodically re-hashes all local medical records, compares against
 * blockchain-anchored versions, flags tampered/corrupted records,
 * alerts users/admins, and re-anchors records with valid local copies.
 */

import crypto, { randomUUID } from 'crypto';

import stellarAnchorService from './stellarService';
import type {
  RecordReconciliationResult,
  ReconciliationReport,
  ReconciliationStatus,
  ReconciliationSummary,
} from '../../src/models/Reconciliation';
import { store, type StoredMedicalRecord } from '../server/store';

// ─── Hashing (mirrors StellarAnchorService.hashPayload) ──────────────────────

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Compute the canonical SHA-256 hash of a stored medical record.
 *  Blockchain-specific fields are excluded so the hash reflects only
 *  the clinical content — matching what was anchored at creation time. */
export function hashRecord(record: StoredMedicalRecord): string {
  const {
    blockchainTxHash: _tx,
    blockchainHash: _bh,
    isBlockchainVerified: _ibv,
    blockchainVerifiedAt: _bva,
    ...payload
  } = record;
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

// ─── In-memory report store ───────────────────────────────────────────────────

const reports = new Map<string, ReconciliationReport>();
let latestReportId: string | null = null;
let isRunning = false;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let nextScheduledAt: Date | null = null;

// ─── Alert helpers ────────────────────────────────────────────────────────────

/** Emit an alert. In production this would push to Datadog/PagerDuty/email.
 *  Here we log to console.error so it surfaces in the Winston error transport. */
function emitAlert(type: 'tampered' | 'spike', payload: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      alert: true,
      alertType: type,
      service: 'reconciliationService',
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  );
}

// ─── Core reconciliation logic ────────────────────────────────────────────────

export class ReconciliationService {
  /**
   * Run a full reconciliation pass over all medical records.
   * Returns the completed report.
   */
  async run(): Promise<ReconciliationReport> {
    if (isRunning) {
      throw new Error('A reconciliation run is already in progress');
    }

    isRunning = true;
    const startedAt = new Date().toISOString();
    const reportId = randomUUID();
    const results: RecordReconciliationResult[] = [];

    try {
      const allRecords = [...store.medicalRecords.values()];

      for (const record of allRecords) {
        const result = await this.checkRecord(record);
        results.push(result);
      }

      // Tally
      const cleanCount = results.filter((r) => r.status === 'clean').length;
      const tamperedCount = results.filter((r) => r.status === 'tampered').length;
      const missingChainCount = results.filter((r) => r.status === 'missing_chain').length;
      const errorCount = results.filter((r) => r.status === 'error').length;
      const reAnchoredCount = results.filter((r) => r.reAnchored).length;

      // Alert if any tampering detected
      if (tamperedCount > 0) {
        emitAlert('tampered', {
          tamperedCount,
          recordIds: results.filter((r) => r.status === 'tampered').map((r) => r.recordId),
        });
      }

      const report: ReconciliationReport = {
        id: reportId,
        startedAt,
        completedAt: new Date().toISOString(),
        totalRecords: allRecords.length,
        cleanCount,
        tamperedCount,
        missingChainCount,
        errorCount,
        reAnchoredCount,
        results,
      };

      reports.set(reportId, report);
      latestReportId = reportId;
      return report;
    } finally {
      isRunning = false;
    }
  }

  /** Check a single record against the blockchain */
  async checkRecord(record: StoredMedicalRecord): Promise<RecordReconciliationResult> {
    const checkedAt = new Date().toISOString();
    const pet = store.pets.get(record.petId);
    const localHash = hashRecord(record);

    const base = {
      recordId: record.id,
      petId: record.petId,
      petName: pet?.name,
      recordType: record.type,
      visitDate: record.visitDate,
      localHash,
      checkedAt,
      reAnchored: false,
    };

    try {
      // No blockchain entry at all
      if (!record.blockchainHash && !record.blockchainTxHash) {
        // Auto re-anchor: record has never been anchored
        const reAnchorResult = await this.tryReAnchor(record, localHash);
        return {
          ...base,
          status: 'missing_chain' as ReconciliationStatus,
          onChainHash: null,
          hashMatch: false,
          reason: 'Record has no blockchain entry. Re-anchoring initiated.',
          ...reAnchorResult,
        };
      }

      const onChainHash = record.blockchainHash ?? null;
      const hashMatch = onChainHash === localHash;

      if (hashMatch) {
        return {
          ...base,
          status: 'clean',
          onChainHash,
          hashMatch: true,
          blockchainTxHash: record.blockchainTxHash,
          reason: 'Local hash matches on-chain hash.',
        };
      }

      // Hash mismatch — tampering detected
      // Attempt re-anchor with the current local copy
      const reAnchorResult = await this.tryReAnchor(record, localHash);

      return {
        ...base,
        status: 'tampered',
        onChainHash,
        hashMatch: false,
        blockchainTxHash: record.blockchainTxHash,
        reason: `Hash mismatch. Local: ${localHash.slice(0, 12)}… On-chain: ${(onChainHash ?? '').slice(0, 12)}…`,
        ...reAnchorResult,
      };
    } catch (err) {
      return {
        ...base,
        status: 'error',
        onChainHash: record.blockchainHash ?? null,
        hashMatch: false,
        reason: err instanceof Error ? err.message : 'Unknown error during reconciliation check',
      };
    }
  }

  /** Attempt to re-anchor a record. Returns partial result fields. */
  private async tryReAnchor(
    record: StoredMedicalRecord,
    localHash: string,
  ): Promise<{ reAnchored: boolean; reAnchorTxHash?: string }> {
    try {
      const anchorResult = await stellarAnchorService.anchorRecord({
        recordId: record.id,
        payload: record,
        network: 'testnet',
      });

      // Update the in-memory store
      const updated: StoredMedicalRecord = {
        ...record,
        blockchainHash: localHash,
        blockchainTxHash: anchorResult.transactionId,
        isBlockchainVerified: anchorResult.status !== 'failed',
        blockchainVerifiedAt: new Date().toISOString(),
      };
      store.medicalRecords.set(record.id, updated);

      return { reAnchored: true, reAnchorTxHash: anchorResult.transactionId };
    } catch {
      return { reAnchored: false };
    }
  }

  // ─── Report access ──────────────────────────────────────────────────────────

  getReport(reportId: string): ReconciliationReport | null {
    return reports.get(reportId) ?? null;
  }

  getLatestReport(): ReconciliationReport | null {
    return latestReportId ? (reports.get(latestReportId) ?? null) : null;
  }

  listReports(): ReconciliationReport[] {
    return [...reports.values()].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

  getSummary(): ReconciliationSummary {
    const latest = this.getLatestReport();
    return {
      lastRunAt: latest?.completedAt ?? null,
      lastReport: latest,
      isRunning,
      nextScheduledAt: nextScheduledAt?.toISOString() ?? null,
    };
  }

  // ─── Scheduler ──────────────────────────────────────────────────────────────

  /**
   * Start a background reconciliation job.
   * @param intervalMs  How often to run (default: 6 hours)
   * @param runImmediately  Run once immediately on start
   */
  startScheduler(intervalMs = 6 * 60 * 60 * 1000, runImmediately = false): void {
    if (schedulerTimer) return; // already running

    const tick = () => {
      nextScheduledAt = new Date(Date.now() + intervalMs);
      this.run().catch((err) => {
        console.error('[reconciliation] scheduled run failed:', err);
      });
    };

    if (runImmediately) tick();

    schedulerTimer = setInterval(tick, intervalMs);
    nextScheduledAt = new Date(Date.now() + intervalMs);
  }

  stopScheduler(): void {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
      nextScheduledAt = null;
    }
  }

  /** Exposed for testing */
  _resetState(): void {
    reports.clear();
    latestReportId = null;
    isRunning = false;
  }
}

export const reconciliationService = new ReconciliationService();
export default reconciliationService;
