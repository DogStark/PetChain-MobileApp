/**
 * Unit tests for src/services/blockchainIntegration.ts
 */

// ─── Mocks (must be declared before imports) ──────────────────────────────────

// Mock AsyncStorage
const mockAsyncStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiGet: jest.fn(),
  multiSet: jest.fn(),
  multiRemove: jest.fn(),
};

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Mock blockchain event service
const mockBlockchainEventService = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  getStatus: jest.fn(),
  on: jest.fn(),
  emit: jest.fn(),
};

jest.mock('../blockchainEventService', () => ({
  __esModule: true,
  default: mockBlockchainEventService,
}));

// Mock blockchain service
const mockVerifyRecordOnChain = jest.fn();
const mockInvalidateBlockchainCacheKey = jest.fn();

jest.mock('../blockchainService', () => ({
  verifyRecordOnChain: mockVerifyRecordOnChain,
  invalidateBlockchainCacheKey: mockInvalidateBlockchainCacheKey,
}));

// Mock logger service
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('../loggerService', () => ({
  loggerService: mockLogger,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  BlockchainIntegrationService,
  type RecordVerificationStatus,
  type IntegrationStatus,
} from '../blockchainIntegration';

// ─── Test Setup ───────────────────────────────────────────────────────────────

describe('BlockchainIntegrationService', () => {
  let service: BlockchainIntegrationService;
  let eventHandlers: Record<string, Function>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock implementations
    mockAsyncStorage.multiGet.mockResolvedValue([
      ['', null],
      ['', null],
    ]);
    mockAsyncStorage.multiSet.mockResolvedValue(undefined);
    mockAsyncStorage.multiRemove.mockResolvedValue(undefined);

    mockBlockchainEventService.connect.mockResolvedValue(undefined);
    mockBlockchainEventService.getStatus.mockReturnValue({
      connected: true,
      subscribedAccounts: ['ACCOUNT1'],
      lastEventTime: Date.now(),
      error: null,
    });

    // Capture event handlers
    eventHandlers = {};
    mockBlockchainEventService.on.mockImplementation((event: string, handler: Function) => {
      eventHandlers[event] = handler;
    });

    service = new BlockchainIntegrationService({
      autoConnect: true,
      verificationCheckInterval: 100, // Faster for tests
      maxPendingVerifications: 10,
    });
  });

  afterEach(async () => {
    await service.disconnect();
  });

  // ─── Initialization Tests ─────────────────────────────────────────────────────

  describe('initialize()', () => {
    it('initializes successfully with auto-connect', async () => {
      const accounts = ['ACCOUNT1', 'ACCOUNT2'];

      await service.initialize(accounts);

      expect(mockBlockchainEventService.connect).toHaveBeenCalledWith(accounts);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing blockchain integration',
        expect.objectContaining({ accounts }),
      );
    });

    it('loads persisted data during initialization', async () => {
      const mockStatuses = [
        {
          recordId: 'record1',
          verified: true,
          transactionHash: 'tx123',
          lastChecked: '2023-01-01T00:00:00Z',
          autoVerified: true,
        },
      ];

      const mockPending = ['record2', 'record3'];

      mockAsyncStorage.multiGet.mockResolvedValue([
        ['@blockchain_verification_status', JSON.stringify(mockStatuses)],
        ['@pending_verifications', JSON.stringify(mockPending)],
      ]);

      await service.initialize(['ACCOUNT1']);

      const status = service.getRecordVerificationStatus('record1');
      expect(status).toMatchObject({
        recordId: 'record1',
        verified: true,
        transactionHash: 'tx123',
      });

      const allStatuses = service.getAllVerificationStatuses();
      expect(allStatuses).toHaveLength(1);
    });

    it('handles initialization errors gracefully', async () => {
      mockBlockchainEventService.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(service.initialize(['ACCOUNT1'])).rejects.toThrow('Connection failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize blockchain integration',
        expect.objectContaining({ error: 'Connection failed' }),
      );
    });

    it('skips initialization if already initialized', async () => {
      await service.initialize(['ACCOUNT1']);

      // Clear mock calls
      mockBlockchainEventService.connect.mockClear();

      await service.initialize(['ACCOUNT2']);

      expect(mockBlockchainEventService.connect).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('Blockchain integration already initialized');
    });
  });

  // ─── Record Management Tests ──────────────────────────────────────────────────

  describe('addRecordForVerification()', () => {
    beforeEach(async () => {
      await service.initialize(['ACCOUNT1']);
    });

    it('adds new record for verification', async () => {
      await service.addRecordForVerification('record1', 'hash123', 'tx456');

      const status = service.getRecordVerificationStatus('record1');
      expect(status).toMatchObject({
        recordId: 'record1',
        verified: false,
        transactionHash: 'tx456',
        autoVerified: false,
      });

      expect(mockAsyncStorage.multiSet).toHaveBeenCalled();
    });

    it('skips already verified records', async () => {
      // Add and verify a record first
      await service.addRecordForVerification('record1');

      // Simulate verification
      const mockVerification = {
        verified: true,
        onChainHash: 'hash123',
        recordId: 'record1',
        txHash: 'tx456',
      };
      mockVerifyRecordOnChain.mockResolvedValue(mockVerification);

      await service.checkRecordVerification('record1', 'hash123');

      // Try to add the same record again
      const addSpy = jest.spyOn(service, 'emit');
      await service.addRecordForVerification('record1');

      expect(addSpy).not.toHaveBeenCalledWith('recordAdded', expect.anything());
    });

    it('triggers immediate verification when hash provided', async () => {
      const mockVerification = {
        verified: true,
        onChainHash: 'hash123',
        recordId: 'record1',
        txHash: 'tx456',
      };
      mockVerifyRecordOnChain.mockResolvedValue(mockVerification);

      await service.addRecordForVerification('record1', 'hash123');

      expect(mockVerifyRecordOnChain).toHaveBeenCalledWith('record1', 'hash123');
    });
  });

  // ─── Verification Tests ───────────────────────────────────────────────────────

  describe('checkRecordVerification()', () => {
    beforeEach(async () => {
      await service.initialize(['ACCOUNT1']);
      await service.addRecordForVerification('record1');
    });

    it('verifies record successfully', async () => {
      const mockVerification = {
        verified: true,
        onChainHash: 'hash123',
        recordId: 'record1',
        txHash: 'tx456',
        ledger: 12345,
      };
      mockVerifyRecordOnChain.mockResolvedValue(mockVerification);

      const result = await service.checkRecordVerification('record1', 'hash123');

      expect(result).toBe(true);
      expect(mockVerifyRecordOnChain).toHaveBeenCalledWith('record1', 'hash123');

      const status = service.getRecordVerificationStatus('record1');
      expect(status?.verified).toBe(true);
      expect(status?.transactionHash).toBe('tx456');
      expect(status?.ledger).toBe(12345);
    });

    it('handles verification failures', async () => {
      mockVerifyRecordOnChain.mockRejectedValue(new Error('Verification failed'));

      const result = await service.checkRecordVerification('record1', 'hash123');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to check record verification',
        expect.objectContaining({
          recordId: 'record1',
          error: 'Verification failed',
        }),
      );
    });
  });

  // ─── Event Handling Tests ─────────────────────────────────────────────────────

  describe('event handling', () => {
    beforeEach(async () => {
      await service.initialize(['ACCOUNT1']);
      await service.addRecordForVerification('record1');
    });

    it('handles transaction events with record IDs', async () => {
      const transactionEvent = {
        transactionHash: 'tx123',
        sourceAccount: 'ACCOUNT1',
        successful: true,
        ledger: 12345,
        operationCount: 1,
        operations: [],
        recordIds: ['record1'],
      };

      // Trigger transaction event
      eventHandlers.transaction({ data: transactionEvent });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      const status = service.getRecordVerificationStatus('record1');
      expect(status?.verified).toBe(true);
      expect(status?.autoVerified).toBe(true);
      expect(status?.transactionHash).toBe('tx123');

      expect(mockInvalidateBlockchainCacheKey).toHaveBeenCalledWith('verify:record1');
    });

    it('handles verification update events', async () => {
      const verificationEvent = {
        recordId: 'record1',
        verified: true,
        transactionHash: 'tx456',
        ledger: 12346,
        timestamp: '2023-01-01T00:00:00Z',
      };

      // Trigger verification update event
      eventHandlers.verificationUpdate({ data: verificationEvent });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      const status = service.getRecordVerificationStatus('record1');
      expect(status?.verified).toBe(true);
      expect(status?.autoVerified).toBe(true);
      expect(status?.transactionHash).toBe('tx456');
    });

    it('forwards connection status events', (done) => {
      const connectionEvent = {
        connected: false,
        error: 'Connection lost',
      };

      service.on('connectionStatus', (data) => {
        expect(data).toEqual(connectionEvent);
        done();
      });

      eventHandlers.connectionStatus({ data: connectionEvent });
    });
  });

  // ─── Status Tests ─────────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('returns integration status', async () => {
      await service.initialize(['ACCOUNT1', 'ACCOUNT2']);
      await service.addRecordForVerification('record1');
      await service.addRecordForVerification('record2');

      const status = service.getStatus();

      expect(status).toMatchObject({
        connected: true,
        activeAccounts: ['ACCOUNT1'],
        pendingVerifications: 2,
        lastEventTime: expect.any(Number),
        error: null,
      });
    });
  });

  // ─── Data Management Tests ────────────────────────────────────────────────────

  describe('data management', () => {
    beforeEach(async () => {
      await service.initialize(['ACCOUNT1']);
    });

    it('clears verification data', async () => {
      await service.addRecordForVerification('record1');
      await service.addRecordForVerification('record2');

      expect(service.getAllVerificationStatuses()).toHaveLength(2);

      await service.clearVerificationData();

      expect(service.getAllVerificationStatuses()).toHaveLength(0);
      expect(mockAsyncStorage.multiRemove).toHaveBeenCalledWith([
        '@blockchain_verification_status',
        '@pending_verifications',
      ]);
    });

    it('persists data on disconnect', async () => {
      await service.addRecordForVerification('record1');

      await service.disconnect();

      expect(mockAsyncStorage.multiSet).toHaveBeenCalled();
      expect(mockBlockchainEventService.disconnect).toHaveBeenCalled();
    });
  });

  // ─── Error Handling Tests ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('handles storage errors gracefully', async () => {
      mockAsyncStorage.multiGet.mockRejectedValue(new Error('Storage error'));

      // Should not throw
      await service.initialize(['ACCOUNT1']);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to load persisted verification data',
        expect.objectContaining({ error: 'Storage error' }),
      );
    });

    it('handles persistence errors gracefully', async () => {
      await service.initialize(['ACCOUNT1']);

      mockAsyncStorage.multiSet.mockRejectedValue(new Error('Persistence error'));

      // Should not throw
      await service.addRecordForVerification('record1');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to persist verification data',
        expect.objectContaining({ error: 'Persistence error' }),
      );
    });
  });
});
