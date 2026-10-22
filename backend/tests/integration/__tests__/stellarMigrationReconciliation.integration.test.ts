import * as StellarSdk from '@stellar/stellar-sdk';

import { StellarMigrationService } from '../../../services/stellarMigrationService';
import {
  MAINNET_TX_ID,
  VALID_HASH,
  VALID_TX_ID,
  cleanupRun,
  ensureCheckpointTable,
  getCheckpoint,
  insertCheckpoint,
  shouldRunIntegrationTests,
  shutdownDatabase,
} from '../helpers/migrationDb';

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(),
  },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
}));

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

const mockAnchorRecord = jest.fn();
const mockHashPayload = jest.fn((payload: unknown) =>
  typeof payload === 'string' ? payload : VALID_HASH,
);

const mockAnchorService = {
  anchorRecord: mockAnchorRecord,
  hashPayload: mockHashPayload,
};

const describeIntegration = shouldRunIntegrationTests() ? describe : describe.skip;

function mockSuccessfulHorizon(hash = VALID_HASH) {
  mockTransactionCall.mockResolvedValue({ successful: true });
  mockOperationsCall.mockResolvedValue({
    records: [
      {
        type: 'manage_data',
        name: 'record:rec-integration-1',
        value: Buffer.from(hash).toString('base64'),
      },
    ],
  });
}

describeIntegration('Stellar migration checkpoint reconciliation integration', () => {
  const runId = `integration-run-${Date.now()}`;
  const userId = 'integration-user';
  const recordId = 'rec-integration-1';

  beforeAll(async () => {
    (StellarSdk.Horizon.Server as jest.Mock).mockImplementation(() => mockHorizonServer);
    await ensureCheckpointTable();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(StellarMigrationService.prototype, 'enumerateTestnetRecords').mockResolvedValue([]);
    await cleanupRun(runId);
  });

  afterAll(async () => {
    await cleanupRun(runId);
    await shutdownDatabase();
  });

  it('persists a verified checkpoint when Stellar submission succeeds', async () => {
    await insertCheckpoint({ runId, recordId, userId, status: 'pending' });
    mockSuccessfulHorizon();
    mockAnchorRecord.mockResolvedValueOnce({
      recordId,
      recordHash: VALID_HASH,
      transactionId: MAINNET_TX_ID,
      status: 'submitted',
    });

    const svc = new StellarMigrationService(mockAnchorService as never);
    const result = await svc.migrateUser(userId, runId);

    expect(result.migrated).toBe(1);
    const checkpoint = await getCheckpoint(recordId, runId);
    expect(checkpoint?.status).toBe('verified');
    expect(checkpoint?.mainnet_tx_id).toBe(MAINNET_TX_ID);
  });

  it('rolls back checkpoint progress when Stellar submission fails', async () => {
    await insertCheckpoint({ runId, recordId, userId, status: 'pending' });
    mockSuccessfulHorizon();
    mockAnchorRecord.mockRejectedValueOnce(new Error('Horizon submission failed'));

    const svc = new StellarMigrationService(mockAnchorService as never);
    const result = await svc.migrateUser(userId, runId);

    expect(result.failed).toBe(1);
    const checkpoint = await getCheckpoint(recordId, runId);
    expect(checkpoint?.status).toBe('failed');
    expect(checkpoint?.mainnet_tx_id).toBeNull();
    expect(checkpoint?.error_message).toContain('Horizon submission failed');
  });

  it('detects diverged on-chain state during reconcile', async () => {
    await insertCheckpoint({
      runId,
      recordId,
      userId,
      status: 'verified',
      mainnetTxId: MAINNET_TX_ID,
    });

    mockSuccessfulHorizon('d'.repeat(64));

    const svc = new StellarMigrationService(mockAnchorService as never);
    const discrepancies = await svc.reconcile(runId);

    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].reason).toBe('hash_mismatch');
  });

  it('reports no discrepancies after manual correction', async () => {
    await insertCheckpoint({
      runId,
      recordId,
      userId,
      status: 'verified',
      mainnetTxId: MAINNET_TX_ID,
      testnetHash: VALID_HASH,
    });

    mockSuccessfulHorizon(VALID_HASH);

    const svc = new StellarMigrationService(mockAnchorService as never);
    const discrepancies = await svc.reconcile(runId);

    expect(discrepancies).toEqual([]);
  });
});

if (!shouldRunIntegrationTests()) {
  it('skips integration suite unless RUN_INTEGRATION_TESTS=true and DATABASE_URL are set', () => {
    expect(true).toBe(true);
  });
}
