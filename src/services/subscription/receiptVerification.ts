import { Platform } from 'react-native';

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
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
  purchaseToken?: string;
  purchasedAt?: string;
  expiresAt?: string;
}

export interface Entitlement {
  active: boolean;
  productId?: string;
  expiresAt?: string;
  source: 'store' | 'account';
}

export interface ReconciliationResult {
  state: ReconciliationState;
  entitlement: Entitlement;
  attempts: number;
  error?: string;
}

export interface ReconciliationContext {
  accountId: string | null;
  receipt: StoreReceipt | null;
}

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;

const INACTIVE_ENTITLEMENT: Entitlement = { active: false, source: 'account' };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
}

function isExpired(receipt: StoreReceipt, now: number): boolean {
  if (!receipt.expiresAt) {
    return false;
  }
  const expires = Date.parse(receipt.expiresAt);
  return Number.isFinite(expires) && expires <= now;
}

/**
 * Server-side receipt verification. The client must never trust a stale local
 * premium flag; entitlement is derived from the verified server response.
 */
export async function verifyReceiptWithServer(
  receipt: StoreReceipt,
  accountId: string,
): Promise<Entitlement> {
  const response = await fetch('/api/subscriptions/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId,
      platform: receipt.platform,
      productId: receipt.productId,
      transactionId: receipt.transactionId,
      originalTransactionId: receipt.originalTransactionId,
      purchaseToken: receipt.purchaseToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Receipt verification failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    active?: boolean;
    productId?: string;
    expiresAt?: string;
    revoked?: boolean;
  };

  if (data.revoked) {
    return { active: false, productId: data.productId, expiresAt: data.expiresAt, source: 'store' };
  }

  return {
    active: Boolean(data.active),
    productId: data.productId ?? receipt.productId,
    expiresAt: data.expiresAt ?? receipt.expiresAt,
    source: 'store',
  };
}

/**
 * Reconciles a restored store purchase against the PetChain account entitlement.
 *
 * - Idempotent: repeating with the same receipt/account yields the same result.
 * - Pending verification never unlocks premium permanently.
 * - Receipts are bound to the account they were verified for, so account
 *   switching cannot attach a receipt to the wrong user.
 */
export async function reconcileEntitlement(
  context: ReconciliationContext,
): Promise<ReconciliationResult> {
  const { accountId, receipt } = context;

  if (!accountId || !receipt) {
    return { state: 'idle', entitlement: INACTIVE_ENTITLEMENT, attempts: 0 };
  }

  const now = Date.now();
  if (isExpired(receipt, now)) {
    return {
      state: 'expired',
      entitlement: { active: false, productId: receipt.productId, expiresAt: receipt.expiresAt, source: 'store' },
      attempts: 0,
    };
  }

  let lastError: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const entitlement = await verifyReceiptWithServer(receipt, accountId);

      if (!entitlement.active) {
        return {
          state: 'revoked',
          entitlement: { ...entitlement, active: false },
          attempts: attempt + 1,
        };
      }

      if (entitlement.expiresAt && Date.parse(entitlement.expiresAt) <= Date.now()) {
        return {
          state: 'expired',
          entitlement: { ...entitlement, active: false },
          attempts: attempt + 1,
        };
      }

      return { state: 'verified', entitlement, attempts: attempt + 1 };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_ATTEMPTS - 1) {
        await delay(backoffMs(attempt));
      }
    }
  }

  return {
    state: 'failed',
    entitlement: INACTIVE_ENTITLEMENT,
    attempts: MAX_ATTEMPTS,
    error: lastError,
  };
}

/**
 * Returns the current platform for store receipt handling.
 */
export function currentStorePlatform(): StorePlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}
