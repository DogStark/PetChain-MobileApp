/**
 * Replay protection for multisig co-sign requests (#953).
 *
 * A captured signing link, deep link, or push payload must not let the same
 * co-sign request be submitted twice. This module centralises the checks the
 * UI runs before it will submit a signature:
 *
 *  - the request must still be in a non-terminal (`pending`) state;
 *  - it must not have expired;
 *  - the current user must be a designated signer who has not already signed;
 *  - a request whose nonce we have already consumed on this device is rejected
 *    even if the server view has not caught up yet (offline / stale cache).
 *
 * `markCoSignConsumed` records the terminal transition atomically for a given
 * request+nonce so concurrent taps / re-entered screens converge.
 */
import type { PendingTransactionResponse } from '../../backend/types/api';

export type CoSignRejectReason =
  | 'not-pending'
  | 'expired'
  | 'not-a-signer'
  | 'already-signed'
  | 'nonce-consumed';

export interface CoSignEligibility {
  canSign: boolean;
  reason?: CoSignRejectReason;
}

/**
 * Stable identity of a co-sign request. Prefers an explicit server nonce in
 * `metadata.nonce`; falls back to the transaction id + creation time so a
 * re-created request with the same id can still be told apart.
 */
export function coSignNonce(transaction: PendingTransactionResponse): string {
  const metaNonce = transaction.metadata?.nonce;
  if (typeof metaNonce === 'string' && metaNonce.length > 0) return metaNonce;
  if (typeof metaNonce === 'number') return String(metaNonce);
  return `${transaction.id}:${transaction.createdAt}`;
}

const consumedNonces = new Set<string>();

/** True once a signature for this request+nonce has been submitted on-device. */
export function isCoSignConsumed(transaction: PendingTransactionResponse): boolean {
  return consumedNonces.has(coSignNonce(transaction));
}

/**
 * Atomically mark a co-sign request as consumed.
 * @returns `true` if this call was the one that consumed it, `false` if it was
 *          already consumed (i.e. the caller lost the race and must not submit).
 */
export function markCoSignConsumed(transaction: PendingTransactionResponse): boolean {
  const nonce = coSignNonce(transaction);
  if (consumedNonces.has(nonce)) return false;
  consumedNonces.add(nonce);
  return true;
}

/**
 * Release a claim made by `markCoSignConsumed` when the submission ultimately
 * failed, so the user can retry. Only call this after a failed submit — never
 * after a successful one.
 */
export function releaseCoSignClaim(transaction: PendingTransactionResponse): void {
  consumedNonces.delete(coSignNonce(transaction));
}

/** Test seam — clear the on-device consumed-nonce ledger. */
export function __resetCoSignReplayGuard(): void {
  consumedNonces.clear();
}

/**
 * Decide whether `currentUserPublicKey` may submit a signature for `transaction`
 * right now. Pure — does not mutate the consumed ledger.
 */
export function evaluateCoSignEligibility(
  transaction: PendingTransactionResponse,
  currentUserPublicKey: string | undefined,
  now: Date = new Date(),
): CoSignEligibility {
  if (transaction.status !== 'pending') {
    return { canSign: false, reason: 'not-pending' };
  }
  if (now.getTime() > new Date(transaction.expiresAt).getTime()) {
    return { canSign: false, reason: 'expired' };
  }
  const signer = transaction.signers.find((s) => s.publicKey === currentUserPublicKey);
  if (!signer) {
    return { canSign: false, reason: 'not-a-signer' };
  }
  if (signer.hasSigned) {
    return { canSign: false, reason: 'already-signed' };
  }
  if (isCoSignConsumed(transaction)) {
    return { canSign: false, reason: 'nonce-consumed' };
  }
  return { canSign: true };
}

/** Human-readable copy for each rejection reason (surfaced in an alert). */
export const CO_SIGN_REJECT_MESSAGE: Record<CoSignRejectReason, string> = {
  'not-pending': 'This request has already been completed, rejected, or expired.',
  expired: 'This request has expired and can no longer be signed.',
  'not-a-signer': 'You are not a designated signer for this request.',
  'already-signed': 'You have already signed this request.',
  'nonce-consumed': 'This request was already submitted from this device.',
};
