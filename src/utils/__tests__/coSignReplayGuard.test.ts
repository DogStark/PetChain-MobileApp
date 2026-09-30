/**
 * #953 — a captured co-sign link / push payload must not let a completed or
 * in-flight request be signed again.
 */
import {
  coSignNonce,
  evaluateCoSignEligibility,
  markCoSignConsumed,
  releaseCoSignClaim,
  isCoSignConsumed,
  __resetCoSignReplayGuard,
  CO_SIGN_REJECT_MESSAGE,
} from '../coSignReplayGuard';
import type { PendingTransactionResponse } from '../../../backend/types/api';

const ME = 'GME';

const tx = (over: Partial<PendingTransactionResponse> = {}): PendingTransactionResponse => ({
  id: 'tx-1',
  multisigAccountId: 'acc-1',
  operationType: 'ownership_transfer',
  description: 'Transfer Rex to co-owner',
  requiredSignatures: 2,
  currentSignatureCount: 0,
  signers: [
    { publicKey: ME, name: 'Me', hasSigned: false },
    { publicKey: 'GOTHER', name: 'Other', hasSigned: false },
  ],
  status: 'pending',
  createdBy: 'GOTHER',
  expiresAt: '2999-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => __resetCoSignReplayGuard());

describe('coSignNonce', () => {
  it('prefers an explicit server nonce', () => {
    expect(coSignNonce(tx({ metadata: { nonce: 'srv-nonce-9' } }))).toBe('srv-nonce-9');
  });
  it('falls back to id + createdAt', () => {
    expect(coSignNonce(tx())).toBe('tx-1:2026-01-01T00:00:00.000Z');
  });
});

describe('evaluateCoSignEligibility', () => {
  it('allows a designated, unsigned signer on a pending request', () => {
    expect(evaluateCoSignEligibility(tx(), ME)).toEqual({ canSign: true });
  });

  it.each([
    ['approved', 'not-pending'],
    ['rejected', 'not-pending'],
    ['expired', 'not-pending'],
  ] as const)('blocks a terminal (%s) request', (status, reason) => {
    const res = evaluateCoSignEligibility(tx({ status }), ME);
    expect(res).toEqual({ canSign: false, reason });
  });

  it('blocks an expired request even while still marked pending', () => {
    const res = evaluateCoSignEligibility(
      tx({ expiresAt: '2020-01-01T00:00:00.000Z' }),
      ME,
      new Date('2026-08-26T00:00:00.000Z'),
    );
    expect(res).toEqual({ canSign: false, reason: 'expired' });
  });

  it('blocks a non-signer', () => {
    expect(evaluateCoSignEligibility(tx(), 'GSTRANGER')).toEqual({
      canSign: false,
      reason: 'not-a-signer',
    });
  });

  it('blocks a signer who already signed', () => {
    const t = tx({ signers: [{ publicKey: ME, hasSigned: true }, { publicKey: 'GOTHER', hasSigned: false }] });
    expect(evaluateCoSignEligibility(t, ME)).toEqual({ canSign: false, reason: 'already-signed' });
  });

  it('blocks replay once the nonce has been consumed on this device', () => {
    const t = tx();
    expect(markCoSignConsumed(t)).toBe(true);
    expect(evaluateCoSignEligibility(t, ME)).toEqual({ canSign: false, reason: 'nonce-consumed' });
  });
});

describe('markCoSignConsumed', () => {
  it('is atomic — only the first caller wins', () => {
    const t = tx();
    expect(markCoSignConsumed(t)).toBe(true);
    expect(markCoSignConsumed(t)).toBe(false);
    expect(isCoSignConsumed(t)).toBe(true);
  });

  it('treats a re-created request with the same id but new createdAt as distinct', () => {
    markCoSignConsumed(tx());
    expect(isCoSignConsumed(tx({ createdAt: '2026-02-02T00:00:00.000Z' }))).toBe(false);
  });

  it('releaseCoSignClaim re-opens a request after a failed submit', () => {
    const t = tx();
    markCoSignConsumed(t);
    releaseCoSignClaim(t);
    expect(isCoSignConsumed(t)).toBe(false);
    expect(evaluateCoSignEligibility(t, ME)).toEqual({ canSign: true });
  });
});

describe('CO_SIGN_REJECT_MESSAGE', () => {
  it('has copy for every reason', () => {
    for (const reason of ['not-pending', 'expired', 'not-a-signer', 'already-signed', 'nonce-consumed'] as const) {
      expect(typeof CO_SIGN_REJECT_MESSAGE[reason]).toBe('string');
    }
  });
});
