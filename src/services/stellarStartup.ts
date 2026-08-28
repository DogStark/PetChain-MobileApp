/**
 * Launch-time recovery for Stellar transactions (issue #947).
 *
 * Kept separate from `stellarTransactionRegistry` so `App.tsx` does not pull the
 * Horizon SDK into the first render path, and so the reconciliation policy —
 * how loudly to fail, what to log — lives apart from the mechanism.
 */

import { reconcilePendingTransactions } from './stellarTransactionRegistry';

export interface ReconciliationSummary {
  checked: number;
  confirmed: number;
  failed: number;
  /** Still unresolved, e.g. Horizon was unreachable. Retried next launch. */
  stillPending: number;
}

/**
 * Resolve every transaction left in flight by a previous run.
 *
 * Never throws: a failure here must not block app startup, and an unreachable
 * Horizon simply leaves records pending for the next attempt.
 */
export async function reconcilePendingStellarTransactions(): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    checked: 0,
    confirmed: 0,
    failed: 0,
    stillPending: 0,
  };

  try {
    const records = await reconcilePendingTransactions();
    summary.checked = records.length;

    for (const record of records) {
      if (record.status === 'confirmed') summary.confirmed += 1;
      else if (record.status === 'failed') summary.failed += 1;
      else summary.stillPending += 1;
    }
  } catch {
    // Startup must proceed regardless. Records stay pending and are retried
    // on the next launch.
  }

  return summary;
}
