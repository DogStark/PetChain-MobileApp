/**
 * Reconciliation domain models
 * Issue #102 — Automated Vet Record Reconciliation
 */

export type ReconciliationStatus = 'clean' | 'tampered' | 'missing_chain' | 'error';

export interface RecordReconciliationResult {
  recordId: string;
  petId: string;
  petName?: string;
  recordType: string;
  visitDate: string;
  status: ReconciliationStatus;
  /** Hash computed from the local record */
  localHash: string;
  /** Hash stored on the blockchain (null if never anchored) */
  onChainHash: string | null;
  /** Whether the local hash matches the on-chain hash */
  hashMatch: boolean;
  /** Stellar transaction ID for the on-chain entry */
  blockchainTxHash?: string;
  /** ISO timestamp of the last reconciliation check */
  checkedAt: string;
  /** Human-readable reason for the status */
  reason?: string;
  /** Whether this record was re-anchored during this run */
  reAnchored: boolean;
  reAnchorTxHash?: string;
}

export interface ReconciliationReport {
  id: string;
  /** ISO timestamp when the reconciliation run started */
  startedAt: string;
  /** ISO timestamp when the run completed */
  completedAt: string;
  /** Total records examined */
  totalRecords: number;
  /** Records with matching hashes */
  cleanCount: number;
  /** Records where local hash differs from on-chain hash */
  tamperedCount: number;
  /** Records that have no blockchain entry yet */
  missingChainCount: number;
  /** Records that errored during check */
  errorCount: number;
  /** Records that were successfully re-anchored */
  reAnchoredCount: number;
  results: RecordReconciliationResult[];
}

export interface ReconciliationSummary {
  lastRunAt: string | null;
  lastReport: ReconciliationReport | null;
  isRunning: boolean;
  nextScheduledAt: string | null;
}
