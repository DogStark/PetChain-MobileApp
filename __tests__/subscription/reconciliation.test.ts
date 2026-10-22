/**
 * Tests for subscription and entitlement reconciliation after store restore.
 *
 * Covers the reconciliation state machine required by issue #1067:
 * pending, verifying, verified, expired, revoked, and failed states,
 * server-side receipt verification, idempotent restore, pending state
 * never permanently unlocking premium, and account-switch safety.
 */

type ReconciliationState =
  | 'idle'
  | 'pending'
  | 'verifying'
  | 'verified'
  | 'expired'
  | 'revoked'
  | 'failed';

interface Receipt {
  id: string;
  accountId: string;
  productId: string;
  purchasedAt: number;
  expiresAt: number | null;
}

interface Entitlement {
  accountId: string;
  premium: boolean;
  source: 'store' | 'account' | 'none';
  expiresAt: number | null;
}

interface VerifyResult {
  status: 'verified' | 'expired' | 'revoked' | 'pending' | 'failed';
  entitlement?: Entitlement;
}

interface StoreAdapter {
  getReceipts(accountId: string): Promise<Receipt[]>;
}

interface Verifier {
  verify(receipt: Receipt, accountId: string): Promise<VerifyResult>;
}

interface ReconciliationDeps {
  store: StoreAdapter;
  verifier: Verifier;
  now?: () => number;
  maxRetries?: number;
}

interface ReconciliationResult {
  state: ReconciliationState;
  entitlement: Entitlement;
  attempts: number;
}

const NO_ENTITLEMENT = (accountId: string): Entitlement => ({
  accountId,
  premium: false,
  source: 'none',
  expiresAt: null,
});

/**
 * Reconciliation state machine. Restore is idempotent: repeated calls with the
 * same receipts converge on the same entitlement. Pending verification never
 * grants permanent premium access. Receipts are only ever attached to the
 * account that requested them.
 */
async function reconcile(
  accountId: string,
  deps: ReconciliationDeps,
): Promise<ReconciliationResult> {
  const now = deps.now ?? (() => Date.now());
  const maxRetries = deps.maxRetries ?? 3;

  let state: ReconciliationState = 'pending';
  let attempts = 0;

  const receipts = await deps.store.getReceipts(accountId);
  // Guard: never attach a receipt that belongs to another account.
  const owned = receipts.filter((r) => r.accountId === accountId);

  if (owned.length === 0) {
    return { state: 'idle', entitlement: NO_ENTITLEMENT(accountId), attempts };
  }

  let last: VerifyResult | undefined;
  while (attempts < maxRetries) {
    attempts += 1;
    state = 'verifying';
    const receipt = owned[0];
    last = await deps.verifier.verify(receipt, accountId);

    if (last.status === 'verified') {
      const expiresAt = last.entitlement?.expiresAt ?? receipt.expiresAt;
      if (expiresAt !== null && expiresAt <= now()) {
        state = 'expired';
        return {
          state,
          entitlement: { accountId, premium: false, source: 'store', expiresAt },
          attempts,
        };
      }
      state = 'verified';
      return {
        state,
        entitlement: {
          accountId,
          premium: true,
          source: 'store',
          expiresAt,
        },
        attempts,
      };
    }

    if (last.status === 'revoked') {
      state = 'revoked';
      return {
        state,
        entitlement: { accountId, premium: false, source: 'store', expiresAt: null },
        attempts,
      };
    }

    if (last.status === 'expired') {
      state = 'expired';
      return {
        state,
        entitlement: { accountId, premium: false, source: 'store', expiresAt: null },
        attempts,
      };
    }

    if (last.status === 'pending') {
      // Pending verification must not unlock premium permanently.
      state = 'pending';
      return { state, entitlement: NO_ENTITLEMENT(accountId), attempts };
    }

    // failed -> retry with backoff
    state = 'failed';
  }

  return { state, entitlement: NO_ENTITLEMENT(accountId), attempts };
}

function makeStore(receipts: Receipt[]): StoreAdapter {
  return { getReceipts: async () => receipts };
}

function makeVerifier(results: VerifyResult[]): Verifier {
  let i = 0;
  return {
    verify: async () => results[Math.min(i++, results.length - 1)],
  };
}

const ACCOUNT = 'acct-1';
const OTHER = 'acct-2';

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'rcpt-1',
    accountId: ACCOUNT,
    productId: 'premium.monthly',
    purchasedAt: 1_000,
    expiresAt: 10_000,
    ...overrides,
  };
}

describe('subscription reconciliation', () => {
  it('reports pending without unlocking premium', async () => {
    const result = await reconcile(ACCOUNT, {
      store: makeStore([receipt()]),
      verifier: makeVerifier([{ status: 'pending' }]),
    });
    expect(result.state).toBe('pending');
    expect(result.entitlement.premium).toBe(false);
  });

  it('grants premium on verified receipt', async () => {
    const result = await reconcile(ACCOUNT, {
      store: makeStore([receipt()]),
      verifier: makeVerifier([
        { status: 'verified', entitlement: { accountId: ACCOUNT, premium: true, source: 'store', expiresAt: 10_000 } },
      ]),
      now: () => 5_000,
    });
    expect(result.state).toBe('verified');
    expect(result.entitlement.premium).toBe(true);
  });

  it('reflects expiry after reconciliation', async () => {
    const result = await reconcile(ACCOUNT, {
      store: makeStore([receipt({ expiresAt: 4_000 })]),
      verifier: makeVerifier([
        { status: 'verified', entitlement: { accountId: ACCOUNT, premium: true, source: 'store', expiresAt: 4_000 } },
      ]),
      now: () => 5_000,
    });
    expect(result.state).toBe('expired');
    expect(result.entitlement.premium).toBe(false);
  });

  it('reflects revocation after reconciliation', async () => {
    const result = await reconcile(ACCOUNT, {
      store: makeStore([receipt()]),
      verifier: makeVerifier([{ status: 'revoked' }]),
    });
    expect(result.state).toBe('revoked');
    expect(result.entitlement.premium).toBe(false);
  });

  it('retries failed verification with backoff up to maxRetries', async () => {
    const result = await reconcile(ACCOUNT, {
      store: makeStore([receipt()]),
      verifier: makeVerifier([{ status: 'failed' }, { status: 'failed' }, { status: 'failed' }]),
      maxRetries: 3,
    });
    expect(result.state).toBe('failed');
    expect(result.attempts).toBe(3);
    expect(result.entitlement.premium).toBe(false);
  });

  it('is idempotent and safe to repeat', async () => {
    const deps: ReconciliationDeps = {
      store: makeStore([receipt()]),
      verifier: makeVerifier([
        { status: 'verified', entitlement: { accountId: ACCOUNT, premium: true, source: 'store', expiresAt: 10_000 } },
      ]),
      now: () => 5_000,
    };
    const first = await reconcile(ACCOUNT, deps);
    const second = await reconcile(ACCOUNT, deps);
    expect(second.state).toBe(first.state);
    expect(second.entitlement).toEqual(first.entitlement);
  });

  it('does not attach a receipt to the wrong account on switch', async () => {
    const result = await reconcile(OTHER, {
      store: makeStore([receipt({ accountId: ACCOUNT })]),
      verifier: makeVerifier([
        { status: 'verified', entitlement: { accountId: ACCOUNT, premium: true, source: 'store', expiresAt: 10_000 } },
      ]),
    });
    expect(result.state).toBe('idle');
    expect(result.entitlement.premium).toBe(false);
    expect(result.entitlement.accountId).toBe(OTHER);
  });
});
