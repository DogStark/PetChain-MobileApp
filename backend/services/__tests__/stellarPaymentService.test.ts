import crypto from 'crypto';

jest.mock('@stellar/stellar-sdk');
jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

import { query } from '../../src/db';
import * as StellarSdk from '@stellar/stellar-sdk';

type IdempotencyRow = {
  idempotencyKey: string;
  sourceAccount: string;
  destinationAccount: string;
  amountXlm: string;
  memo: string;
  sequenceNumber: string;
  status: 'processing' | 'submitted' | 'failed';
  transactionHash?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

const mockQuery = query as jest.MockedFunction<typeof query>;

const paymentRows = new Map<string, IdempotencyRow>();
const mockServer = {
  loadAccount: jest.fn(),
  submitTransaction: jest.fn(),
};

const mockKeypair = {
  publicKey: jest.fn(() => 'GRECEIVINGACCOUNT'),
};

const mockTx = {
  sign: jest.fn(),
};

const mockBuilder = {
  addOperation: jest.fn().mockReturnThis(),
  addMemo: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn(() => mockTx),
};

(StellarSdk.Horizon.Server as unknown as jest.Mock).mockImplementation(() => mockServer);
(StellarSdk.Keypair.fromSecret as unknown as jest.Mock).mockReturnValue(mockKeypair);
(StellarSdk.TransactionBuilder as unknown as jest.Mock).mockImplementation(() => mockBuilder);
(StellarSdk.Asset.native as unknown as jest.Mock).mockReturnValue({ type: 'native' });
(StellarSdk.Operation.payment as unknown as jest.Mock).mockImplementation((input) => input);
(StellarSdk.Memo.text as unknown as jest.Mock).mockImplementation((memo) => memo);

const { processRefund } = require('../stellarPaymentService') as typeof import('../stellarPaymentService');

function computeIdempotencyKey(
  sourceAccount: string,
  destinationAccount: string,
  amountXlm: string,
  memo: string,
  sequenceNumber: string,
) {
  return crypto
    .createHash('sha256')
    .update([sourceAccount, destinationAccount, amountXlm, memo, sequenceNumber].join('|'))
    .digest('hex');
}

function responseRow(row: IdempotencyRow) {
  return {
    idempotencyKey: row.idempotencyKey,
    sourceAccount: row.sourceAccount,
    destinationAccount: row.destinationAccount,
    amountXlm: row.amountXlm,
    memo: row.memo,
    sequenceNumber: row.sequenceNumber,
    status: row.status,
    transactionHash: row.transactionHash ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

function installQueryMock() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('DELETE FROM payment_idempotency_keys') && sql.includes('expires_at <= $1')) {
      const cutoff = new Date(String(params?.[0] ?? new Date().toISOString())).getTime();
      let removed = 0;
      for (const [key, row] of paymentRows.entries()) {
        if (new Date(row.expiresAt).getTime() <= cutoff) {
          paymentRows.delete(key);
          removed += 1;
        }
      }
      return { rowCount: removed, rows: [] } as Awaited<ReturnType<typeof query>>;
    }

    if (sql.includes('INSERT INTO payment_idempotency_keys')) {
      const [idempotencyKey, sourceAccount, destinationAccount, amountXlm, memo, sequenceNumber] =
        params as string[];

      if (paymentRows.has(idempotencyKey)) {
        return { rowCount: 0, rows: [] } as Awaited<ReturnType<typeof query>>;
      }

      const now = new Date().toISOString();
      paymentRows.set(idempotencyKey, {
        idempotencyKey,
        sourceAccount,
        destinationAccount,
        amountXlm,
        memo,
        sequenceNumber,
        status: 'processing',
        transactionHash: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      return { rowCount: 1, rows: [{ idempotency_key: idempotencyKey }] } as Awaited<
        ReturnType<typeof query>
      >;
    }

    if (sql.includes('SELECT') && sql.includes('FROM payment_idempotency_keys')) {
      const key = String(params?.[0]);
      const row = paymentRows.get(key);
      return {
        rowCount: row ? 1 : 0,
        rows: row ? [responseRow(row)] : [],
      } as Awaited<ReturnType<typeof query>>;
    }

    if (sql.includes("SET status = 'submitted'")) {
      const key = String(params?.[0]);
      const txHash = String(params?.[1]);
      const row = paymentRows.get(key);
      if (row) {
        row.status = 'submitted';
        row.transactionHash = txHash;
        row.updatedAt = new Date().toISOString();
        paymentRows.set(key, row);
      }
      return { rowCount: row ? 1 : 0, rows: [] } as Awaited<ReturnType<typeof query>>;
    }

    if (sql.includes("SET status = 'failed'")) {
      const key = String(params?.[0]);
      const row = paymentRows.get(key);
      if (row) {
        row.status = 'failed';
        row.updatedAt = new Date().toISOString();
        paymentRows.set(key, row);
      }
      return { rowCount: row ? 1 : 0, rows: [] } as Awaited<ReturnType<typeof query>>;
    }

    return { rowCount: 0, rows: [] } as Awaited<ReturnType<typeof query>>;
  });
}

beforeEach(() => {
  paymentRows.clear();
  jest.clearAllMocks();
  installQueryMock();
  (mockServer.loadAccount as jest.Mock).mockResolvedValue({ sequence: '100' });
  (mockServer.submitTransaction as jest.Mock).mockResolvedValue({ hash: 'tx-hash-1' });
});

describe('stellarPaymentService', () => {
  it('submits a first payment and caches the submitted hash', async () => {
    const hash = await processRefund('GDESTINATION', '10');

    expect(hash).toBe('tx-hash-1');
    expect(mockServer.submitTransaction).toHaveBeenCalledTimes(1);
    expect(paymentRows.size).toBe(1);
    expect([...paymentRows.values()][0].status).toBe('submitted');
  });

  it('returns the cached result for a duplicate submission', async () => {
    const idempotencyKey = computeIdempotencyKey(
      'GRECEIVINGACCOUNT',
      'GDESTINATION',
      '10',
      'PetChain refund',
      '101',
    );
    paymentRows.set(idempotencyKey, {
      idempotencyKey,
      sourceAccount: 'GRECEIVINGACCOUNT',
      destinationAccount: 'GDESTINATION',
      amountXlm: '10',
      memo: 'PetChain refund',
      sequenceNumber: '101',
      status: 'submitted',
      transactionHash: 'tx-cached',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const hash = await processRefund('GDESTINATION', '10');

    expect(hash).toBe('tx-cached');
    expect(mockServer.submitTransaction).not.toHaveBeenCalled();
  });

  it('expires stale keys and allows resubmission', async () => {
    const idempotencyKey = computeIdempotencyKey(
      'GRECEIVINGACCOUNT',
      'GDESTINATION',
      '10',
      'PetChain refund',
      '101',
    );
    paymentRows.set(idempotencyKey, {
      idempotencyKey,
      sourceAccount: 'GRECEIVINGACCOUNT',
      destinationAccount: 'GDESTINATION',
      amountXlm: '10',
      memo: 'PetChain refund',
      sequenceNumber: '101',
      status: 'submitted',
      transactionHash: 'tx-old',
      createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const hash = await processRefund('GDESTINATION', '10');

    expect(hash).toBe('tx-hash-1');
    expect(mockServer.submitTransaction).toHaveBeenCalledTimes(1);
    expect(paymentRows.size).toBe(1);
    expect([...paymentRows.values()][0].transactionHash).toBe('tx-hash-1');
  });
});
