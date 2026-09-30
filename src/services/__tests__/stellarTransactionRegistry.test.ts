/**
 * Idempotent submission and pending-transaction reconciliation
 * (issues #946 and #947).
 */

import type * as StellarSdk from '@stellar/stellar-sdk';

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
  },
}));

jest.mock('../../config/stellarNetwork', () => ({
  getStellarNetworkProfile: () => ({
    network: 'TESTNET',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    friendbotUrl: 'https://friendbot.stellar.org',
    isProduction: false,
  }),
}));

import {
  __clearInFlight,
  getPendingTransactions,
  getTransactionByHash,
  inFlightCount,
  isAmbiguousFailure,
  reconcilePendingTransactions,
  submitTransactionOnce,
  type SubmissionBackend,
} from '../stellarTransactionRegistry';

/** A stand-in for a signed transaction: only hash() and toXDR() are used. */
function fakeTransaction(hash: string): StellarSdk.Transaction {
  return {
    hash: () => Buffer.from(hash, 'hex'),
    toXDR: () => `xdr-for-${hash}`,
  } as unknown as StellarSdk.Transaction;
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function backendOf(overrides: Partial<SubmissionBackend> = {}): SubmissionBackend {
  return {
    submit: jest.fn(async () => ({ hash: HASH_A, ledger: 100, successful: true })),
    lookup: jest.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  mockStore.clear();
  __clearInFlight();
  jest.clearAllMocks();
});

// ── #946: rapid taps ───────────────────────────────────────────────────────

describe('duplicate submission across rapid taps', () => {
  it('collapses concurrent submissions of the same envelope into one network call', async () => {
    const gate = deferred<{ hash: string; ledger: number; successful: boolean }>();
    const backend = backendOf({ submit: jest.fn(() => gate.promise) });
    const tx = fakeTransaction(HASH_A);

    // Three taps before the first resolves.
    const first = submitTransactionOnce(tx, { backend });
    const second = submitTransactionOnce(tx, { backend });
    const third = submitTransactionOnce(tx, { backend });

    expect(inFlightCount()).toBe(1);

    gate.resolve({ hash: HASH_A, ledger: 100, successful: true });
    const results = await Promise.all([first, second, third]);

    expect(backend.submit).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === 'confirmed')).toBe(true);
  });

  it('clears the in-flight entry once settled, so a later retry can proceed', async () => {
    const backend = backendOf({
      submit: jest.fn(async () => {
        throw Object.assign(new Error('bad_seq'), {
          response: {
            status: 400,
            data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
          },
        });
      }),
    });

    await submitTransactionOnce(fakeTransaction(HASH_A), { backend });
    expect(inFlightCount()).toBe(0);
  });

  it('never re-submits a transaction already confirmed', async () => {
    const backend = backendOf();
    const tx = fakeTransaction(HASH_A);

    await submitTransactionOnce(tx, { backend });
    const again = await submitTransactionOnce(tx, { backend });

    expect(backend.submit).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ status: 'confirmed', deduplicated: true });
  });

  it('treats different envelopes as different transactions', async () => {
    const backend = backendOf({
      submit: jest.fn(async (tx) => ({
        hash: (tx as unknown as { toXDR: () => string }).toXDR().replace('xdr-for-', ''),
        ledger: 1,
        successful: true,
      })),
    });

    await submitTransactionOnce(fakeTransaction(HASH_A), { backend });
    await submitTransactionOnce(fakeTransaction(HASH_B), { backend });

    expect(backend.submit).toHaveBeenCalledTimes(2);
  });
});

// ── #946: ambiguous timeouts ───────────────────────────────────────────────

describe('classifying failures', () => {
  it.each([
    ['a timeout', new Error('Request timeout of 10000ms exceeded')],
    ['a dropped socket', new Error('socket hang up')],
    ['a 504', Object.assign(new Error('gateway'), { response: { status: 504 } })],
    ['an unrecognised failure', { weird: true }],
  ])('treats %s as ambiguous', (_label, error) => {
    expect(isAmbiguousFailure(error)).toBe(true);
  });

  it.each([
    [
      'a Horizon result code',
      Object.assign(new Error('bad'), {
        response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } },
      }),
    ],
    ['a 400', Object.assign(new Error('bad request'), { response: { status: 400 } })],
  ])('treats %s as definite', (_label, error) => {
    expect(isAmbiguousFailure(error)).toBe(false);
  });
});

describe('ambiguous submission is reconciled, not retried blindly', () => {
  it('confirms the payment when Horizon shows it landed', async () => {
    const backend = backendOf({
      submit: jest.fn(async () => {
        throw new Error('Request timeout of 10000ms exceeded');
      }),
      lookup: jest.fn(async () => ({ successful: true, ledger: 4242 })),
    });

    const result = await submitTransactionOnce(fakeTransaction(HASH_A), { backend });

    // The critical assertion: a timed-out payment that actually succeeded must
    // not be reported as failed, or the caller would pay twice.
    expect(result.status).toBe('confirmed');
    expect(result.ledger).toBe(4242);
    expect(backend.lookup).toHaveBeenCalledWith(HASH_A);
    expect(backend.submit).toHaveBeenCalledTimes(1);
  });

  it('marks it failed only when Horizon has never seen the hash', async () => {
    const backend = backendOf({
      submit: jest.fn(async () => {
        throw new Error('network error');
      }),
      lookup: jest.fn(async () => null),
    });

    const result = await submitTransactionOnce(fakeTransaction(HASH_A), { backend });
    expect(result.status).toBe('failed');
  });

  it('leaves it pending when Horizon itself is unreachable', async () => {
    const backend = backendOf({
      submit: jest.fn(async () => {
        throw new Error('network error');
      }),
      lookup: jest.fn(async () => {
        throw new Error('horizon unreachable');
      }),
    });

    const result = await submitTransactionOnce(fakeTransaction(HASH_A), { backend });

    // An unreachable Horizon is not evidence of failure. Reporting failure here
    // would invite a duplicate rebuild.
    expect(result.status).toBe('pending');
    expect((await getTransactionByHash(HASH_A))?.status).toBe('pending');
  });

  it('does not re-submit on a definite rejection', async () => {
    const backend = backendOf({
      submit: jest.fn(async () => {
        throw Object.assign(new Error('bad'), {
          response: {
            status: 400,
            data: { extras: { result_codes: { transaction: 'tx_insufficient_balance' } } },
          },
        });
      }),
    });

    const result = await submitTransactionOnce(fakeTransaction(HASH_A), { backend });

    expect(result.status).toBe('failed');
    expect(result.resultCode).toBe('tx_insufficient_balance');
    expect(backend.lookup).not.toHaveBeenCalled();
  });
});

// ── #947: persistence and reconciliation ───────────────────────────────────

describe('pending transactions survive termination', () => {
  it('persists the record before the network call', async () => {
    let observed: string | undefined;
    const backend = backendOf({
      submit: jest.fn(async () => {
        // Simulates the app being inspected mid-flight.
        observed = (await getTransactionByHash(HASH_A))?.status;
        return { hash: HASH_A, ledger: 1, successful: true };
      }),
    });

    await submitTransactionOnce(fakeTransaction(HASH_A), { backend, operationKey: 'pay-1' });

    expect(observed).toBe('submitting');
  });

  it('stores the signed envelope and never a secret key', async () => {
    await submitTransactionOnce(fakeTransaction(HASH_A), {
      backend: backendOf(),
      operationKey: 'pay-1',
    });

    const raw = mockStore.get('@stellar/pending_transactions') ?? '';
    expect(raw).toContain(`xdr-for-${HASH_A}`);
    // Stellar secret keys are strkey-encoded and start with 'S'.
    expect(raw).not.toMatch(/"S[A-Z2-7]{55}"/);
  });

  it('records the caller business key for cross-referencing', async () => {
    await submitTransactionOnce(fakeTransaction(HASH_A), {
      backend: backendOf(),
      operationKey: 'payment-99',
    });

    expect((await getTransactionByHash(HASH_A))?.operationKey).toBe('payment-99');
  });

  it('resolves a record left in flight by a previous app launch', async () => {
    // A record stranded by termination.
    mockStore.set(
      '@stellar/pending_transactions',
      JSON.stringify([
        {
          hash: HASH_A,
          envelopeXdr: `xdr-for-${HASH_A}`,
          operationKey: 'pay-1',
          status: 'submitting',
          createdAt: '2026-08-25T00:00:00.000Z',
          updatedAt: '2026-08-25T00:00:00.000Z',
          attempts: 1,
        },
      ]),
    );

    const backend = backendOf({ lookup: jest.fn(async () => ({ successful: true, ledger: 77 })) });
    const results = await reconcilePendingTransactions(backend);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'confirmed', ledger: 77 });
    expect((await getTransactionByHash(HASH_A))?.status).toBe('confirmed');
  });

  it('leaves already-resolved records alone', async () => {
    mockStore.set(
      '@stellar/pending_transactions',
      JSON.stringify([
        {
          hash: HASH_A,
          envelopeXdr: 'x',
          status: 'confirmed',
          createdAt: '',
          updatedAt: '',
          attempts: 1,
        },
        {
          hash: HASH_B,
          envelopeXdr: 'y',
          status: 'failed',
          createdAt: '',
          updatedAt: '',
          attempts: 1,
        },
      ]),
    );

    const backend = backendOf();
    const results = await reconcilePendingTransactions(backend);

    expect(results).toHaveLength(0);
    expect(backend.lookup).not.toHaveBeenCalled();
  });

  it('is safe to run repeatedly', async () => {
    const backend = backendOf({ lookup: jest.fn(async () => ({ successful: true, ledger: 5 })) });
    await submitTransactionOnce(fakeTransaction(HASH_A), { backend });

    await reconcilePendingTransactions(backend);
    await reconcilePendingTransactions(backend);

    const records = await getPendingTransactions();
    expect(records.filter((r) => r.hash === HASH_A)).toHaveLength(1);
  });

  it('survives corrupt stored data rather than blocking a payment', async () => {
    mockStore.set('@stellar/pending_transactions', 'not json at all');

    const result = await submitTransactionOnce(fakeTransaction(HASH_A), { backend: backendOf() });
    expect(result.status).toBe('confirmed');
  });
});
