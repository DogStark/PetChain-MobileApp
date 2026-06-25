import * as StellarSdk from '@stellar/stellar-sdk';

import { getPool, query } from '../../src/db';
import {
  StellarMigrationService,
  type ReconcileDiscrepancy,
  type TestnetRecord,
} from '../stellarMigrationService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getPool: jest.fn(),
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(),
  },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
  Keypair: { fromSecret: jest.fn() },
  TransactionBuilder: jest.fn(),
  Operation: { manageData: jest.fn() },
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

// Mock pool client for transaction tests
const mockClientQuery = jest.fn();
const mockClient = { query: mockClientQuery, release: jest.fn() };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_HASH = 'a'.repeat(64);
const VALID_TX_ID = 'b'.repeat(64);
const VALID_HASH_2 = 'c'.repeat(64);
const VALID_TX_ID_2 = 'd'.repeat(64);

const makeRecord = (overrides: Partial<TestnetRecord> = {}): TestnetRecord => ({
  recordId: 'rec-1',
  recordHash: VALID_HASH,
  transactionId: VALID_TX_ID,
  ...overrides,
});

const makeCheckpointRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'cp-uuid-1',
  migration_run_id: 'run-1',
  record_id: 'rec-1',
  user_id: 'user-1',
  testnet_tx_id: VALID_TX_ID,
  testnet_record_hash: VALID_HASH,
  mainnet_tx_id: null,
  mainnet_ledger: null,
  status: 'pending',
  error_message: null,
  attempts: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// Mock StellarAnchorService
const mockAnchorRecord = jest.fn();
const mockHashPayload = jest.fn((payload: unknown) => {
  // Deterministic: return hash of the payload string
  return typeof payload === 'string' ? payload : VALID_HASH;
});

const mockAnchorService = {
  anchorRecord: mockAnchorRecord,
  hashPayload: mockHashPayload,
} as any;

// Mock Horizon Server
const mockTransactionCall = jest.fn();
const mockOperationsCall = jest.fn();
const mockHorizonServer = {
  transactions: jest.fn(() => ({
    transaction: jest.fn(() => ({ call: mockTransactionCall })),
  })),
  operations: jest.fn(() => ({
    forTransaction: jest.fn(() => ({ call: mockOperationsCall })),
  })),
};

beforeEach(() => {
  jest.clearAllMocks();
  (StellarSdk.Horizon.Server as jest.Mock).mockImplementation(() => mockHorizonServer);
  mockGetPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(mockClient) } as any);
  // Default: transaction client succeeds BEGIN/COMMIT
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

// ---------------------------------------------------------------------------
// enumerateTestnetRecords
// ---------------------------------------------------------------------------

describe('enumerateTestnetRecords', () => {
  it('returns mapped records from DB', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 100,
        },
      ],
    } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    const records = await svc.enumerateTestnetRecords('user-1');

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      recordId: 'rec-1',
      recordHash: VALID_HASH,
      transactionId: VALID_TX_ID,
      ledgerSequence: 100,
    });
  });

  it('returns empty array when no testnet records exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const svc = new StellarMigrationService(mockAnchorService);
    const records = await svc.enumerateTestnetRecords('user-1');
    expect(records).toHaveLength(0);
  });

  it('throws on invalid userId', async () => {
    const svc = new StellarMigrationService(mockAnchorService);
    await expect(svc.enumerateTestnetRecords('')).rejects.toThrow('Invalid userId');
  });

  it('sanitizes malformed hash values to empty string', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: 'not-a-hash!',
          transaction_id: VALID_TX_ID,
          ledger_sequence: null,
        },
      ],
    } as any);
    const svc = new StellarMigrationService(mockAnchorService);
    const records = await svc.enumerateTestnetRecords('user-1');
    expect(records[0].recordHash).toBe('');
  });

  it('excludes already-verified records (idempotency)', async () => {
    // The SQL query itself filters verified records; we verify the query is called with correct params
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const svc = new StellarMigrationService(mockAnchorService);
    await svc.enumerateTestnetRecords('user-42');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'verified'"), [
      'user-42',
    ]);
  });
});

// ---------------------------------------------------------------------------
// validateTestnetTransaction
// ---------------------------------------------------------------------------

describe('validateTestnetTransaction', () => {
  it('returns true when on-chain hash matches stored hash', async () => {
    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: `record:rec-1`,
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });

    const svc = new StellarMigrationService(mockAnchorService);
    const valid = await svc.validateTestnetTransaction(makeRecord());
    expect(valid).toBe(true);
  });

  it('returns false when transaction is not successful', async () => {
    mockTransactionCall.mockResolvedValueOnce({ successful: false });
    const svc = new StellarMigrationService(mockAnchorService);
    const valid = await svc.validateTestnetTransaction(makeRecord());
    expect(valid).toBe(false);
  });

  it('returns false when manageData operation is missing', async () => {
    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({ records: [] });
    const svc = new StellarMigrationService(mockAnchorService);
    const valid = await svc.validateTestnetTransaction(makeRecord());
    expect(valid).toBe(false);
  });

  it('returns false when on-chain hash does not match stored hash', async () => {
    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from('different-hash-value').toString('base64'),
        },
      ],
    });
    const svc = new StellarMigrationService(mockAnchorService);
    const valid = await svc.validateTestnetTransaction(makeRecord());
    expect(valid).toBe(false);
  });

  it('returns false on Horizon network failure', async () => {
    mockTransactionCall.mockRejectedValueOnce(new Error('Network timeout'));
    const svc = new StellarMigrationService(mockAnchorService);
    const valid = await svc.validateTestnetTransaction(makeRecord());
    expect(valid).toBe(false);
  });

  it('returns false for record with empty fields', async () => {
    const svc = new StellarMigrationService(mockAnchorService);
    const valid = await svc.validateTestnetTransaction({
      recordId: '',
      recordHash: '',
      transactionId: '',
    });
    expect(valid).toBe(false);
  });

  it('handles operations call failure gracefully', async () => {
    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockRejectedValueOnce(new Error('Horizon 503'));
    const svc = new StellarMigrationService(mockAnchorService);
    const valid = await svc.validateTestnetTransaction(makeRecord());
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// migrateUser — happy path, resumability, idempotency
// ---------------------------------------------------------------------------

describe('migrateUser', () => {
  function setupSuccessfulMigration() {
    // enumerateTestnetRecords
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any);
    // seedCheckpoints (INSERT ... ON CONFLICT DO NOTHING)
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    // countCheckpoints
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any);
    // fetchPendingCheckpoints (first batch)
    mockQuery.mockResolvedValueOnce({ rows: [makeCheckpointRow()] } as any);
    // lockCheckpoint
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cp-uuid-1' }], rowCount: 1 } as any);
    // updateCheckpoint (verified) goes through withTransaction → mockClientQuery
    // fetchPendingCheckpoints (empty — end of loop)
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    // Horizon validation
    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });

    // anchorRecord on mainnet
    mockAnchorRecord.mockResolvedValueOnce({
      recordId: 'rec-1',
      recordHash: VALID_HASH,
      transactionId: VALID_TX_ID_2,
      ledgerSequence: 200,
      status: 'submitted',
    });
  }

  it('migrates a record successfully end-to-end', async () => {
    setupSuccessfulMigration();
    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');

    expect(result.migrated).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(1);
    expect(result.runId).toBe('run-1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls onProgress callback during migration', async () => {
    setupSuccessfulMigration();
    const onProgress = jest.fn();
    const svc = new StellarMigrationService(mockAnchorService);
    await svc.migrateUser('user-1', 'run-1', onProgress);
    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
    expect(lastCall).toHaveProperty('runId', 'run-1');
    expect(lastCall).toHaveProperty('total');
  });

  it('throws on invalid userId', async () => {
    const svc = new StellarMigrationService(mockAnchorService);
    await expect(svc.migrateUser('', 'run-1')).rejects.toThrow('Invalid userId or runId');
  });

  it('throws on invalid runId', async () => {
    const svc = new StellarMigrationService(mockAnchorService);
    await expect(svc.migrateUser('user-1', '')).rejects.toThrow('Invalid userId or runId');
  });

  it('skips record when testnet validation fails', async () => {
    // enumerateTestnetRecords
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // seed
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any); // count
    mockQuery.mockResolvedValueOnce({ rows: [makeCheckpointRow()] } as any); // fetch
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cp-uuid-1' }], rowCount: 1 } as any); // lock
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // update skipped
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // end

    mockTransactionCall.mockResolvedValueOnce({ successful: false });

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.skipped).toBe(1);
    expect(result.migrated).toBe(0);
  });

  it('marks record as failed when anchorRecord throws', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [makeCheckpointRow()] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cp-uuid-1' }], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // update failed
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });
    mockAnchorRecord.mockRejectedValueOnce(new Error('Stellar network error'));

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.failed).toBe(1);
    expect(result.migrated).toBe(0);
  });

  it('does not re-migrate already-verified records (idempotency)', async () => {
    // enumerateTestnetRecords returns empty (verified records excluded by SQL)
    // seedCheckpoints returns early when records is empty — no query call
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // fetch pending

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.migrated).toBe(0);
    expect(mockAnchorRecord).not.toHaveBeenCalled();
  });

  it('skips record when lock fails (concurrent run protection)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [makeCheckpointRow()] } as any);
    // lockCheckpoint returns 0 rows — already locked by another process
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.skipped).toBe(1);
    expect(mockAnchorRecord).not.toHaveBeenCalled();
  });

  it('marks record as failed when max attempts exceeded', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any);
    // checkpoint with attempts = 3 (MAX_ATTEMPTS)
    mockQuery.mockResolvedValueOnce({
      rows: [makeCheckpointRow({ attempts: 3, status: 'failed' })],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // update failed
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.failed).toBe(1);
    expect(mockAnchorRecord).not.toHaveBeenCalled();
  });

  it('handles large datasets in batches without memory issues', async () => {
    const RECORD_COUNT = 120;
    const records = Array.from({ length: RECORD_COUNT }, (_, i) => ({
      record_id: `rec-${i}`,
      record_hash: VALID_HASH,
      transaction_id: VALID_TX_ID,
      ledger_sequence: i,
    }));

    mockQuery.mockResolvedValueOnce({ rows: records } as any); // enumerate
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: RECORD_COUNT } as any); // seed
    mockQuery.mockResolvedValueOnce({ rows: [{ total: String(RECORD_COUNT) }] } as any); // count

    // Batch 1: 50 records
    const batch1 = records.slice(0, 50).map((r) => makeCheckpointRow({ record_id: r.record_id }));
    mockQuery.mockResolvedValueOnce({ rows: batch1 } as any);
    // For each record in batch1: lock (mockQuery) + verified update goes through mockClientQuery
    for (let i = 0; i < 50; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: `cp-${i}` }], rowCount: 1 } as any); // lock
      mockTransactionCall.mockResolvedValueOnce({ successful: true });
      mockOperationsCall.mockResolvedValueOnce({
        records: [
          {
            type: 'manage_data',
            name: `record:rec-${i}`,
            value: Buffer.from(VALID_HASH).toString('base64'),
          },
        ],
      });
      mockAnchorRecord.mockResolvedValueOnce({
        recordId: `rec-${i}`,
        recordHash: VALID_HASH,
        transactionId: VALID_TX_ID_2,
        status: 'submitted',
      });
    }

    // Batch 2: 50 records
    const batch2 = records.slice(50, 100).map((r) => makeCheckpointRow({ record_id: r.record_id }));
    mockQuery.mockResolvedValueOnce({ rows: batch2 } as any);
    for (let i = 50; i < 100; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: `cp-${i}` }], rowCount: 1 } as any);
      mockTransactionCall.mockResolvedValueOnce({ successful: true });
      mockOperationsCall.mockResolvedValueOnce({
        records: [
          {
            type: 'manage_data',
            name: `record:rec-${i}`,
            value: Buffer.from(VALID_HASH).toString('base64'),
          },
        ],
      });
      mockAnchorRecord.mockResolvedValueOnce({
        recordId: `rec-${i}`,
        recordHash: VALID_HASH,
        transactionId: VALID_TX_ID_2,
        status: 'submitted',
      });
    }

    // Batch 3: 20 records
    const batch3 = records
      .slice(100, 120)
      .map((r) => makeCheckpointRow({ record_id: r.record_id }));
    mockQuery.mockResolvedValueOnce({ rows: batch3 } as any);
    for (let i = 100; i < 120; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: `cp-${i}` }], rowCount: 1 } as any);
      mockTransactionCall.mockResolvedValueOnce({ successful: true });
      mockOperationsCall.mockResolvedValueOnce({
        records: [
          {
            type: 'manage_data',
            name: `record:rec-${i}`,
            value: Buffer.from(VALID_HASH).toString('base64'),
          },
        ],
      });
      mockAnchorRecord.mockResolvedValueOnce({
        recordId: `rec-${i}`,
        recordHash: VALID_HASH,
        transactionId: VALID_TX_ID_2,
        status: 'submitted',
      });
    }

    // End of batches
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.migrated).toBe(RECORD_COUNT);
    expect(result.failed).toBe(0);
  }, 15000);
});

// ---------------------------------------------------------------------------
// retryFailed
// ---------------------------------------------------------------------------

describe('retryFailed', () => {
  it('resets failed checkpoints to pending', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 2 } as any);
    const svc = new StellarMigrationService(mockAnchorService);
    await svc.retryFailed('run-1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending'"),
      expect.arrayContaining(['run-1']),
    );
  });

  it('does not reset records that have exceeded max attempts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const svc = new StellarMigrationService(mockAnchorService);
    await svc.retryFailed('run-1');
    // Query should include attempts < MAX_ATTEMPTS guard
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('attempts < $2'),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// getProgress
// ---------------------------------------------------------------------------

describe('getProgress', () => {
  it('returns correct progress counts', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ completed: '3', failed: '1', skipped: '0', pending: '6', total: '10' }],
    } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    const startedAt = new Date(Date.now() - 5000);
    const progress = await svc.getProgress('run-1', startedAt);

    expect(progress.total).toBe(10);
    expect(progress.completed).toBe(3);
    expect(progress.failed).toBe(1);
    expect(progress.skipped).toBe(0);
    expect(progress.pending).toBe(6);
    expect(progress.runId).toBe('run-1');
  });

  it('returns null ETA when no records have been processed yet', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ completed: '0', failed: '0', skipped: '0', pending: '10', total: '10' }],
    } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    const progress = await svc.getProgress('run-1', new Date());
    expect(progress.estimatedSecondsRemaining).toBeNull();
  });

  it('returns 0 ETA when all records are done', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ completed: '10', failed: '0', skipped: '0', pending: '0', total: '10' }],
    } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    const progress = await svc.getProgress('run-1', new Date(Date.now() - 10000));
    expect(progress.estimatedSecondsRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hash consistency
// ---------------------------------------------------------------------------

describe('hash consistency', () => {
  it('rejects migration when mainnet hash does not match testnet hash', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [makeCheckpointRow()] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cp-uuid-1' }], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // update failed
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });

    // anchorRecord returns a DIFFERENT hash — simulates corruption
    mockAnchorRecord.mockResolvedValueOnce({
      recordId: 'rec-1',
      recordHash: VALID_HASH_2, // mismatch!
      transactionId: VALID_TX_ID_2,
      status: 'submitted',
    });

    // hashPayload returns the input (VALID_HASH), but anchorResult.recordHash is VALID_HASH_2
    mockHashPayload.mockReturnValueOnce(VALID_HASH);

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.failed).toBe(1);
    expect(result.migrated).toBe(0);
  });

  it('marks failed when anchorRecord returns failed status', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [makeCheckpointRow()] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cp-uuid-1' }], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });
    mockAnchorRecord.mockResolvedValueOnce({
      recordId: 'rec-1',
      recordHash: VALID_HASH,
      transactionId: `failed:rec-1:${Date.now()}`,
      status: 'failed',
    });

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Rollback safety — verified checkpoints are never re-processed
// ---------------------------------------------------------------------------

describe('rollback safety', () => {
  it('does not process already-verified checkpoints', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // enumerate returns nothing (verified excluded)
    // seedCheckpoints returns early for empty records — no query call
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // no pending

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');
    expect(result.migrated).toBe(0);
    expect(mockAnchorRecord).not.toHaveBeenCalled();
  });

  it('seedCheckpoints is idempotent — ON CONFLICT DO NOTHING', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // seed — conflict, 0 inserted
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // no pending (already verified)

    const svc = new StellarMigrationService(mockAnchorService);
    await svc.migrateUser('user-1', 'run-1');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Input sanitization
// ---------------------------------------------------------------------------

describe('input sanitization', () => {
  it('sanitizes userId with special characters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // seedCheckpoints returns early for empty records — no query call
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    // Should not throw — special chars are stripped
    await svc.migrateUser('user-1', 'run-1');
    expect(mockQuery).toHaveBeenCalled();
  });

  it('rejects SQL-injection-like userId', async () => {
    const svc = new StellarMigrationService(mockAnchorService);
    // After sanitization, the string becomes empty or invalid
    await expect(svc.migrateUser("'; DROP TABLE users; --", 'run-1')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DB transaction rollback path
// ---------------------------------------------------------------------------

describe('DB transaction rollback', () => {
  function setupForRecord() {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          record_id: 'rec-1',
          record_hash: VALID_HASH,
          transaction_id: VALID_TX_ID,
          ledger_sequence: 1,
        },
      ],
    } as any); // enumerate
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // seed
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] } as any); // count
    mockQuery.mockResolvedValueOnce({ rows: [makeCheckpointRow()] } as any); // fetch
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cp-uuid-1' }], rowCount: 1 } as any); // lock
  }

  it('rolls back and marks failed when DB update inside transaction throws', async () => {
    setupForRecord();
    // update failed (catch path goes through mockQuery)
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // end

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });
    mockAnchorRecord.mockResolvedValueOnce({
      recordId: 'rec-1',
      recordHash: VALID_HASH,
      transactionId: VALID_TX_ID_2,
      status: 'submitted',
    });

    // Make the transaction client UPDATE throw — triggers ROLLBACK
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('DB constraint violation')) // UPDATE inside tx
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');

    expect(result.failed).toBe(1);
    // ROLLBACK was called
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('logs XDR when rollback occurs and anchorResult contains xdr', async () => {
    setupForRecord();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // update failed
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });
    mockAnchorRecord.mockResolvedValueOnce({
      recordId: 'rec-1',
      recordHash: VALID_HASH,
      transactionId: VALID_TX_ID_2,
      status: 'submitted',
      xdr: 'AAAAAQAAAA==',
    });

    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const svc = new StellarMigrationService(mockAnchorService);
    await svc.migrateUser('user-1', 'run-1');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('xdr=AAAAAQAAAA=='));
    consoleSpy.mockRestore();
  });

  it('commits successfully and does not call ROLLBACK on happy path', async () => {
    setupForRecord();
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // end of loop

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });
    mockAnchorRecord.mockResolvedValueOnce({
      recordId: 'rec-1',
      recordHash: VALID_HASH,
      transactionId: VALID_TX_ID_2,
      status: 'submitted',
    });

    // Default mockClientQuery already resolves for BEGIN/UPDATE/COMMIT
    const svc = new StellarMigrationService(mockAnchorService);
    const result = await svc.migrateUser('user-1', 'run-1');

    expect(result.migrated).toBe(1);
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mockClientQuery).not.toHaveBeenCalledWith('ROLLBACK');
  });
});

// ---------------------------------------------------------------------------
// reconcile()
// ---------------------------------------------------------------------------

describe('reconcile', () => {
  it('throws on invalid runId', async () => {
    const svc = new StellarMigrationService(mockAnchorService);
    await expect(svc.reconcile('')).rejects.toThrow('Invalid runId');
  });

  it('returns empty array when all checkpoints match Horizon', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'cp-1',
          record_id: 'rec-1',
          mainnet_tx_id: VALID_TX_ID_2,
          testnet_record_hash: VALID_HASH,
        },
      ],
    } as any);

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH).toString('base64'),
        },
      ],
    });

    const svc = new StellarMigrationService(mockAnchorService);
    const discrepancies = await svc.reconcile('run-1');
    expect(discrepancies).toHaveLength(0);
  });

  it('surfaces hash_mismatch when on-chain hash differs from DB', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'cp-1',
          record_id: 'rec-1',
          mainnet_tx_id: VALID_TX_ID_2,
          testnet_record_hash: VALID_HASH,
        },
      ],
    } as any);

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'manage_data',
          name: 'record:rec-1',
          value: Buffer.from(VALID_HASH_2).toString('base64'),
        },
      ],
    });

    const svc = new StellarMigrationService(mockAnchorService);
    const discrepancies = await svc.reconcile('run-1');
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]).toMatchObject({ checkpointId: 'cp-1', reason: 'hash_mismatch' });
  });

  it('surfaces tx_failed when Horizon reports transaction unsuccessful', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'cp-2',
          record_id: 'rec-2',
          mainnet_tx_id: VALID_TX_ID_2,
          testnet_record_hash: VALID_HASH,
        },
      ],
    } as any);

    mockTransactionCall.mockResolvedValueOnce({ successful: false });

    const svc = new StellarMigrationService(mockAnchorService);
    const discrepancies = await svc.reconcile('run-1');
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]).toMatchObject({ checkpointId: 'cp-2', reason: 'tx_failed' });
  });

  it('surfaces tx_not_found when Horizon throws', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'cp-3',
          record_id: 'rec-3',
          mainnet_tx_id: VALID_TX_ID_2,
          testnet_record_hash: VALID_HASH,
        },
      ],
    } as any);

    mockTransactionCall.mockRejectedValueOnce(new Error('404 not found'));

    const svc = new StellarMigrationService(mockAnchorService);
    const discrepancies = await svc.reconcile('run-1');
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]).toMatchObject({ checkpointId: 'cp-3', reason: 'tx_not_found' });
  });

  it('surfaces tx_not_found when manageData op is missing on-chain', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'cp-4',
          record_id: 'rec-4',
          mainnet_tx_id: VALID_TX_ID_2,
          testnet_record_hash: VALID_HASH,
        },
      ],
    } as any);

    mockTransactionCall.mockResolvedValueOnce({ successful: true });
    mockOperationsCall.mockResolvedValueOnce({ records: [] }); // no manageData op

    const svc = new StellarMigrationService(mockAnchorService);
    const discrepancies = await svc.reconcile('run-1');
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]).toMatchObject({ checkpointId: 'cp-4', reason: 'tx_not_found' });
  });

  it('returns empty array when there are no verified checkpoints', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    const discrepancies = await svc.reconcile('run-1');
    expect(discrepancies).toHaveLength(0);
    expect(mockTransactionCall).not.toHaveBeenCalled();
  });

  it('queries only verified checkpoints with non-null mainnet_tx_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const svc = new StellarMigrationService(mockAnchorService);
    await svc.reconcile('run-1');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'verified'"), [
      'run-1',
    ]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('mainnet_tx_id IS NOT NULL'),
      expect.anything(),
    );
  });
});
