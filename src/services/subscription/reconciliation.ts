/**
 * Subscription & entitlement reconciliation after store restore.
 *
 * A restored App Store / Play purchase may arrive after sign-in, offline
 * startup, or account migration. Premium access must never be granted or
 * removed based solely on a stale local flag: every restore is reconciled
 * against server-side receipt verification and the PetChain account
 * entitlement.
 *
 * The state machine distinguishes store ownership (what the store says the
 * device owns) from account entitlement (what the signed-in PetChain account
 * is entitled to). Pending verification never unlocks premium permanently.
 */

export type StorePlatform = 'ios' | 'android';

export type ReconciliationState =
  | 'idle'
  | 'pending'
  | 'verifying'
  | 'verified'
  | 'expired'
  | 'revoked'
  | 'failed';

export interface StoreReceipt {
  platform: StorePlatform;
  /** Store transaction / original transaction identifier. */
  transactionId: string;
  /** Opaque receipt payload forwarded to the server for verification. */
  receipt: string;
  productId: string;
}

export interface Entitlement {
  /** PetChain account the entitlement belongs to. */
  accountId: string;
  premium: boolean;
  expiresAt?: string | null;
}

export interface ReconciliationResult {
  state: ReconciliationState;
  /** Store ownership as reported by the store, independent of the account. */
  storeOwns: boolean;
  /** Account entitlement as verified server-side. */
  entitlement: Entitlement | null;
  /** True only when the account is verified premium. */
  premium: boolean;
  /** True while verification is outstanding; never unlocks premium. */
  pending: boolean;
  /** True when the caller may retry the reconciliation. */
  retryable: boolean;
  /** Number of attempts already made for this reconciliation. */
  attempts: number;
  error?: string;
}

/**
 * Server-side receipt verification. Implementations must verify the receipt
 * against the store and return the entitlement for the *given* account, so a
 * receipt can never be attached to the wrong user.
 */
export interface ReceiptVerifier {
  verifyReceipt(input: {
    accountId: string;
    receipt: StoreReceipt;
  }): Promise<Entitlement>;
}

export interface ReconciliationOptions {
  verifier: ReceiptVerifier;
  /** Max verification attempts before the reconciliation is marked failed. */
  maxAttempts?: number;
  /** Base backoff in ms; grows exponentially per attempt. */
  baseBackoffMs?: number;
  /** Injectable sleep, primarily for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock, primarily for tests. */
  now?: () => number;
  /** Called on every state transition. */
  onStateChange?: (state: ReconciliationState, result: ReconciliationResult) => void;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reconciles a restored store purchase with the signed-in PetChain account.
 *
 * Idempotent: repeating a restore for the same account/receipt converges on
 * the same verified entitlement and never double-grants premium. Pending
 * verification is surfaced as `pending` and never unlocks premium.
 */
export class SubscriptionReconciler {
  private readonly verifier: ReceiptVerifier;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly onStateChange?: (
    state: ReconciliationState,
    result: ReconciliationResult,
  ) => void;

  /** In-flight reconciliation keyed by account + transaction, for idempotency. */
  private readonly inFlight = new Map<string, Promise<ReconciliationResult>>();

  constructor(options: ReconciliationOptions) {
    this.verifier = options.verifier;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
    this.onStateChange = options.onStateChange;
  }

  /**
   * Reconcile a restored receipt for the given account.
   *
   * Safe to call repeatedly: concurrent calls for the same account/receipt
   * share a single verification, and completed calls are re-verified against
   * the server rather than trusting a cached local flag.
   */
  async reconcile(accountId: string, receipt: StoreReceipt): Promise<ReconciliationResult> {
    if (!accountId) {
      return this.emit('failed', {
        state: 'failed',
        storeOwns: true,
        entitlement: null,
        premium: false,
        pending: false,
        retryable: false,
        attempts: 0,
        error: 'missing account id',
      });
    }

    const key = `${accountId}:${receipt.platform}:${receipt.transactionId}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const run = this.run(accountId, receipt).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, run);
    return run;
  }

  private async run(accountId: string, receipt: StoreReceipt): Promise<ReconciliationResult> {
    let attempts = 0;
    let lastError: string | undefined;

    this.emit('pending', {
      state: 'pending',
      storeOwns: true,
      entitlement: null,
      premium: false,
      pending: true,
      retryable: true,
      attempts,
    });

    while (attempts < this.maxAttempts) {
      attempts += 1;
      this.emit('verifying', {
        state: 'verifying',
        storeOwns: true,
        entitlement: null,
        premium: false,
        pending: true,
        retryable: true,
        attempts,
      });

      try {
        const entitlement = await this.verifier.verifyReceipt({ accountId, receipt });

        // Guard against a verifier returning an entitlement for another user.
        if (entitlement.accountId !== accountId) {
          return this.emit('failed', {
            state: 'failed',
            storeOwns: true,
            entitlement: null,
            premium: false,
            pending: false,
            retryable: false,
            attempts,
            error: 'entitlement account mismatch',
          });
        }

        if (this.isExpired(entitlement)) {
          return this.emit('expired', {
            state: 'expired',
            storeOwns: true,
            entitlement,
            premium: false,
            pending: false,
            retryable: false,
            attempts,
          });
        }

        if (!entitlement.premium) {
          return this.emit('revoked', {
            state: 'revoked',
            storeOwns: true,
            entitlement,
            premium: false,
            pending: false,
            retryable: false,
            attempts,
          });
        }

        return this.emit('verified', {
          state: 'verified',
          storeOwns: true,
          entitlement,
          premium: true,
          pending: false,
          retryable: false,
          attempts,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempts < this.maxAttempts) {
          await this.sleep(this.backoffFor(attempts));
        }
      }
    }

    return this.emit('failed', {
      state: 'failed',
      storeOwns: true,
      entitlement: null,
      premium: false,
      pending: false,
      retryable: true,
      attempts,
      error: lastError ?? 'verification failed',
    });
  }

  private isExpired(entitlement: Entitlement): boolean {
    if (!entitlement.expiresAt) {
      return false;
    }
    const expiresAt = Date.parse(entitlement.expiresAt);
    if (Number.isNaN(expiresAt)) {
      return false;
    }
    return expiresAt <= this.now();
  }

  private backoffFor(attempt: number): number {
    return this.baseBackoffMs * Math.pow(2, attempt - 1);
  }

  private emit(state: ReconciliationState, result: ReconciliationResult): ReconciliationResult {
    this.onStateChange?.(state, result);
    return result;
  }
}
