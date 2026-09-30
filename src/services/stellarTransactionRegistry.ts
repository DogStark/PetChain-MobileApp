/**
 * Idempotent Stellar submission and durable pending-transaction tracking
 * (issues #946 and #947).
 *
 * ## The duplicate-payment problem (#946)
 *
 * Two distinct hazards, which need different defences:
 *
 * 1. **Rapid taps.** Two submissions race before the first resolves. Collapsed
 *    here by an in-flight map, so concurrent callers share one promise and one
 *    network call.
 *
 * 2. **Ambiguous timeouts.** The request times out and the caller cannot tell
 *    whether Horizon accepted it. Naively retrying by *rebuilding* the
 *    transaction consumes a new sequence number and can pay twice.
 *
 * The defence for (2) rests on a property of Stellar: a signed envelope has a
 * deterministic hash, and resubmitting **the same envelope** is idempotent —
 * the network either accepts it once or reports it as already applied. So this
 * module keys everything by that hash, and after an ambiguous failure it
 * *reconciles* by asking Horizon whether the hash already landed, rather than
 * assuming failure and rebuilding.
 *
 * ## The lost-status problem (#947)
 *
 * The app can be terminated between submitting and confirming, losing all
 * knowledge of an in-flight payment. Records are therefore persisted before the
 * network call and reconciled on next launch.
 *
 * **Only non-secret data is stored.** A signed envelope contains the source
 * public key and a signature — exactly what the network sees. The secret key
 * stays in secure storage and never reaches this module.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StellarSdk from '@stellar/stellar-sdk';

import { getStellarNetworkProfile } from '../config/stellarNetwork';
import { storageKeys } from '../config/storageKeys';

export type PendingTransactionStatus =
  /** Handed to Horizon; outcome not yet known. */
  | 'submitting'
  /** Submission returned ambiguously; needs reconciliation against Horizon. */
  | 'pending'
  /** Confirmed applied to the ledger. */
  | 'confirmed'
  /** Definitively rejected. Safe to rebuild. */
  | 'failed';

export interface PendingTransaction {
  /** Deterministic hash of the signed envelope — the idempotency key. */
  hash: string;
  /** Signed envelope XDR. Public data; never contains a secret key. */
  envelopeXdr: string;
  /** Caller-supplied business key (e.g. a paymentId), for cross-referencing. */
  operationKey?: string;
  status: PendingTransactionStatus;
  createdAt: string;
  updatedAt: string;
  /** Number of times submission has been attempted for this envelope. */
  attempts: number;
  ledger?: number;
  resultCode?: string;
  lastError?: string;
}

export interface SubmitResult {
  hash: string;
  status: PendingTransactionStatus;
  /** True when this call did not reach the network because the outcome was known. */
  deduplicated: boolean;
  ledger?: number;
  resultCode?: string;
}

/** Injected so the registry can be tested without a live Horizon. */
export interface SubmissionBackend {
  /** Submit a signed envelope. */
  submit(
    transaction: StellarSdk.Transaction,
  ): Promise<{ hash: string; ledger?: number; successful?: boolean }>;
  /** Look a transaction up by hash. Resolves null when Horizon has never seen it. */
  lookup(
    hash: string,
  ): Promise<{ successful: boolean; ledger?: number; resultCode?: string } | null>;
}

/** Errors that leave the outcome genuinely unknown. */
const AMBIGUOUS_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network error/i,
  /econnreset/i,
  /econnaborted/i,
  /socket hang up/i,
  /aborted/i,
];

const AMBIGUOUS_STATUSES = new Set([408, 502, 503, 504]);

/**
 * Decide whether a failure leaves the transaction's fate unknown.
 *
 * Getting this wrong in the safe direction (treating a definite failure as
 * ambiguous) costs one extra Horizon lookup. Getting it wrong the other way
 * risks a double payment, so anything unrecognised is treated as ambiguous.
 */
export function isAmbiguousFailure(error: unknown): boolean {
  if (error === null || error === undefined) return true;

  const status =
    (error as { response?: { status?: number }; status?: number }).response?.status ??
    (error as { status?: number }).status;
  if (typeof status === 'number') {
    if (AMBIGUOUS_STATUSES.has(status)) return true;
    // Horizon answered with a definite rejection.
    if (status >= 400 && status < 500) return false;
  }

  // A result code means Horizon evaluated the transaction: a definite answer.
  const resultCodes = (error as { response?: { data?: { extras?: { result_codes?: unknown } } } })
    .response?.data?.extras?.result_codes;
  if (resultCodes) return false;

  const message = error instanceof Error ? error.message : String(error);
  if (AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(message))) return true;

  // Unknown shape — assume ambiguous and reconcile.
  return true;
}

function extractResultCode(error: unknown): string | undefined {
  const codes = (
    error as {
      response?: { data?: { extras?: { result_codes?: { transaction?: string } } } };
    }
  ).response?.data?.extras?.result_codes;
  return codes?.transaction;
}

// ── Persistence ────────────────────────────────────────────────────────────

const STORAGE_KEY = storageKeys.stellar.pendingTransactions;

/** Cap the stored history so the key cannot grow without bound. */
const MAX_STORED = 50;

async function readAll(): Promise<PendingTransaction[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingTransaction[]) : [];
  } catch {
    // Corrupt storage must not block a payment.
    return [];
  }
}

async function writeAll(records: PendingTransaction[]): Promise<void> {
  // Keep unresolved records first so trimming never discards live work.
  const unresolved = records.filter((r) => r.status === 'submitting' || r.status === 'pending');
  const resolved = records.filter((r) => r.status === 'confirmed' || r.status === 'failed');
  const trimmed = [...unresolved, ...resolved].slice(0, MAX_STORED);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export async function getPendingTransactions(): Promise<PendingTransaction[]> {
  return readAll();
}

export async function getTransactionByHash(hash: string): Promise<PendingTransaction | undefined> {
  return (await readAll()).find((r) => r.hash === hash);
}

export async function clearResolvedTransactions(): Promise<void> {
  const records = await readAll();
  await writeAll(records.filter((r) => r.status === 'submitting' || r.status === 'pending'));
}

async function upsert(record: PendingTransaction): Promise<void> {
  const records = await readAll();
  const index = records.findIndex((r) => r.hash === record.hash);
  if (index >= 0) records[index] = record;
  else records.unshift(record);
  await writeAll(records);
}

// ── In-flight de-duplication ───────────────────────────────────────────────

const inFlight = new Map<string, Promise<SubmitResult>>();

/** Test hook. */
export function __clearInFlight(): void {
  inFlight.clear();
}

/** Number of submissions currently awaiting a network answer. */
export function inFlightCount(): number {
  return inFlight.size;
}

// ── Default backend ────────────────────────────────────────────────────────

function defaultBackend(): SubmissionBackend {
  const { horizonUrl } = getStellarNetworkProfile();
  const server = new StellarSdk.Horizon.Server(horizonUrl);

  return {
    async submit(transaction) {
      const response = await server.submitTransaction(transaction);
      return {
        hash: response.hash,
        ledger: (response as { ledger?: number }).ledger,
        successful: (response as { successful?: boolean }).successful ?? true,
      };
    },
    async lookup(hash) {
      try {
        const tx = (await server.transactions().transaction(hash).call()) as unknown as {
          successful?: boolean;
          ledger_attr?: number;
          ledger?: number;
        };
        return {
          successful: tx.successful ?? true,
          // Horizon names this `ledger_attr` in the SDK's record type.
          ledger: tx.ledger_attr ?? tx.ledger,
          resultCode: undefined,
        };
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        // 404 is a real answer: Horizon has never seen this hash.
        if (status === 404) return null;
        throw error;
      }
    },
  };
}

// ── Submission ─────────────────────────────────────────────────────────────

export interface SubmitOptions {
  /** Business identifier, recorded alongside the transaction. */
  operationKey?: string;
  /** Override the network backend (tests). */
  backend?: SubmissionBackend;
}

/**
 * Submit a signed transaction at most once.
 *
 * Safe to call repeatedly with the same signed envelope: concurrent calls share
 * one network request, and a call whose outcome is already known returns the
 * recorded result without touching the network.
 *
 * @param transaction A **signed** transaction.
 */
export async function submitTransactionOnce(
  transaction: StellarSdk.Transaction,
  options: SubmitOptions = {},
): Promise<SubmitResult> {
  const hash = transaction.hash().toString('hex');

  // Rapid taps: join the existing attempt rather than starting another.
  const existing = inFlight.get(hash);
  if (existing) return existing;

  // The registration below MUST happen before this function awaits anything.
  //
  // An async function runs synchronously up to its first `await`, so a taller
  // stack of taps queued in the same tick all reach that point before any of
  // them yields. An earlier version read persisted state first, which meant
  // every concurrent tap passed the in-flight check above and submitted —
  // precisely the duplicate this module exists to prevent. The storage read now
  // lives inside the registered promise.
  const task = (async (): Promise<SubmitResult> => {
    const stored = await getTransactionByHash(hash);

    // Already resolved: never re-submit a confirmed transaction.
    if (stored?.status === 'confirmed') {
      return {
        hash,
        status: 'confirmed',
        deduplicated: true,
        ledger: stored.ledger,
        resultCode: stored.resultCode,
      };
    }

    const backend = options.backend ?? defaultBackend();
    return performSubmission(transaction, hash, stored, backend, options.operationKey);
  })();

  inFlight.set(hash, task);
  try {
    return await task;
  } finally {
    inFlight.delete(hash);
  }
}

async function performSubmission(
  transaction: StellarSdk.Transaction,
  hash: string,
  stored: PendingTransaction | undefined,
  backend: SubmissionBackend,
  operationKey?: string,
): Promise<SubmitResult> {
  const now = new Date().toISOString();
  const record: PendingTransaction = {
    hash,
    envelopeXdr: transaction.toXDR(),
    operationKey: operationKey ?? stored?.operationKey,
    status: 'submitting',
    createdAt: stored?.createdAt ?? now,
    updatedAt: now,
    attempts: (stored?.attempts ?? 0) + 1,
  };

  // Persist *before* the network call (#947): if the app dies mid-flight the
  // record survives and is reconciled on next launch.
  await upsert(record);

  try {
    const response = await backend.submit(transaction);
    const confirmed: PendingTransaction = {
      ...record,
      status: response.successful === false ? 'failed' : 'confirmed',
      ledger: response.ledger,
      updatedAt: new Date().toISOString(),
    };
    await upsert(confirmed);
    return {
      hash,
      status: confirmed.status,
      deduplicated: false,
      ledger: confirmed.ledger,
    };
  } catch (error) {
    if (!isAmbiguousFailure(error)) {
      const failed: PendingTransaction = {
        ...record,
        status: 'failed',
        resultCode: extractResultCode(error),
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
      await upsert(failed);
      return { hash, status: 'failed', deduplicated: false, resultCode: failed.resultCode };
    }

    // Ambiguous: ask Horizon whether it landed rather than assuming either way.
    const ambiguous: PendingTransaction = {
      ...record,
      status: 'pending',
      lastError: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    await upsert(ambiguous);

    const reconciled = await reconcileOne(ambiguous, backend);
    return {
      hash,
      status: reconciled.status,
      deduplicated: false,
      ledger: reconciled.ledger,
      resultCode: reconciled.resultCode,
    };
  }
}

// ── Reconciliation ─────────────────────────────────────────────────────────

/**
 * Resolve one record against Horizon.
 *
 * A lookup failure leaves the record `pending` on purpose — an unreachable
 * Horizon is not evidence that a transaction failed, and marking it failed
 * would invite a duplicate rebuild.
 */
async function reconcileOne(
  record: PendingTransaction,
  backend: SubmissionBackend,
): Promise<PendingTransaction> {
  try {
    const found = await backend.lookup(record.hash);

    if (found === null) {
      // Horizon has never seen it, so nothing was applied and the sequence
      // number was not consumed. Safe to rebuild.
      const failed: PendingTransaction = {
        ...record,
        status: 'failed',
        lastError: 'not found on Horizon after ambiguous submission',
        updatedAt: new Date().toISOString(),
      };
      await upsert(failed);
      return failed;
    }

    const resolved: PendingTransaction = {
      ...record,
      status: found.successful ? 'confirmed' : 'failed',
      ledger: found.ledger,
      resultCode: found.resultCode,
      updatedAt: new Date().toISOString(),
    };
    await upsert(resolved);
    return resolved;
  } catch {
    return record;
  }
}

/**
 * Resolve every unresolved transaction against Horizon (#947).
 *
 * Call on app launch. Idempotent and safe to run repeatedly.
 *
 * @returns the records after reconciliation.
 */
export async function reconcilePendingTransactions(
  backend: SubmissionBackend = defaultBackend(),
): Promise<PendingTransaction[]> {
  const records = await readAll();
  const unresolved = records.filter((r) => r.status === 'submitting' || r.status === 'pending');

  const results: PendingTransaction[] = [];
  for (const record of unresolved) {
    results.push(await reconcileOne(record, backend));
  }
  return results;
}
