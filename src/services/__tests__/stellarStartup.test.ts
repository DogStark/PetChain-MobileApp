/**
 * Launch-time reconciliation of pending Stellar transactions (issue #947).
 */

const mockReconcile = jest.fn();

jest.mock('../stellarTransactionRegistry', () => ({
  reconcilePendingTransactions: (...args: unknown[]) => mockReconcile(...args),
}));

import { reconcilePendingStellarTransactions } from '../stellarStartup';

function record(status: string) {
  return {
    hash: 'h',
    envelopeXdr: 'x',
    status,
    createdAt: '',
    updatedAt: '',
    attempts: 1,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('startup reconciliation', () => {
  it('reports nothing to do when no transactions were left in flight', async () => {
    mockReconcile.mockResolvedValue([]);

    expect(await reconcilePendingStellarTransactions()).toEqual({
      checked: 0,
      confirmed: 0,
      failed: 0,
      stillPending: 0,
    });
  });

  it('summarises each outcome', async () => {
    mockReconcile.mockResolvedValue([
      record('confirmed'),
      record('confirmed'),
      record('failed'),
      record('pending'),
    ]);

    expect(await reconcilePendingStellarTransactions()).toEqual({
      checked: 4,
      confirmed: 2,
      failed: 1,
      stillPending: 1,
    });
  });

  it('counts an unresolved record as still pending, not as failed', async () => {
    // Horizon unreachable. Treating this as failure would invite a duplicate
    // rebuild of a payment that may well have gone through.
    mockReconcile.mockResolvedValue([record('pending')]);

    const summary = await reconcilePendingStellarTransactions();
    expect(summary.stillPending).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('never throws, so a failure cannot block app startup', async () => {
    mockReconcile.mockRejectedValue(new Error('storage unavailable'));

    await expect(reconcilePendingStellarTransactions()).resolves.toEqual({
      checked: 0,
      confirmed: 0,
      failed: 0,
      stillPending: 0,
    });
  });

  it('is safe to run more than once', async () => {
    mockReconcile.mockResolvedValue([record('confirmed')]);

    await reconcilePendingStellarTransactions();
    await reconcilePendingStellarTransactions();

    expect(mockReconcile).toHaveBeenCalledTimes(2);
  });
});
