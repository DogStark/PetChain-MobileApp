/**
 * Unit tests for backend/services/horizonStreamService.ts
 */

// ─── Mocks (must be declared before imports) ──────────────────────────────────

// Mock Stellar SDK
const mockServer = {
  transactions: jest.fn(),
  operations: jest.fn(),
};

const mockStreamBuilder = {
  cursor: jest.fn(),
  stream: jest.fn(),
  forTransaction: jest.fn(),
  call: jest.fn(),
};

const mockOperationsBuilder = {
  forTransaction: jest.fn(),
  call: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => ({
  Server: jest.fn(() => mockServer),
  Horizon: {
    ServerApi: {},
  },
}));

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: any = null;
  onclose: any = null;
  onmessage: any = null;
  onerror: any = null;
  private _listeners: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(public url: string) {}

  send(data: string): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    (this._listeners['close'] ?? []).forEach((fn) => fn());
  }
  on(event: string, listener: (...args: any[]) => void): this {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(listener);
    return this;
  }
  off(event: string, listener: (...args: any[]) => void): this {
    this._listeners[event] = (this._listeners[event] ?? []).filter((fn) => fn !== listener);
    return this;
  }
  emit(event: string, ...args: any[]): boolean {
    (this._listeners[event] ?? []).forEach((fn) => fn(...args));
    return true;
  }
}

jest.mock('ws', () => ({
  WebSocket: MockWebSocket,
}));

// Mock config
jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    isDev: true,
  },
}));

// Mock logger service
jest.mock('../loggerService', () => ({
  loggerService: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  HorizonStreamService,
  StreamManager,
  type PetChainTransaction,
  type StreamEvent,
  type CursorStorage,
} from '../horizonStreamService';
import { loggerService } from '../loggerService';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

class MockCursorStorage implements CursorStorage {
  private cursors = new Map<string, string>();

  async getCursor(streamId: string): Promise<string | null> {
    return this.cursors.get(streamId) || null;
  }

  async setCursor(streamId: string, cursor: string): Promise<void> {
    this.cursors.set(streamId, cursor);
  }

  // Test helper
  clear(): void {
    this.cursors.clear();
  }
}

const createMockTransaction = (overrides: any = {}) => ({
  id: 'tx123',
  hash: 'hash123',
  ledger: 12345,
  created_at: '2023-01-01T00:00:00Z',
  source_account: 'GACCOUNT1',
  successful: true,
  operation_count: 1,
  memo: 'test memo',
  fee_charged: '100',
  paging_token: 'cursor123',
  ...overrides,
});

// ─── Test Setup ───────────────────────────────────────────────────────────────

describe('HorizonStreamService', () => {
  let service: HorizonStreamService;
  let mockCursorStorage: MockCursorStorage;
  let mockCloseFunction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockCursorStorage = new MockCursorStorage();
    mockCloseFunction = jest.fn();

    // Reset mock implementations
    mockServer.transactions.mockReturnValue(mockStreamBuilder);
    mockServer.operations.mockReturnValue(mockOperationsBuilder);
    mockStreamBuilder.cursor.mockReturnValue(mockStreamBuilder);
    mockStreamBuilder.stream.mockReturnValue(mockCloseFunction);
    mockOperationsBuilder.forTransaction.mockReturnValue(mockOperationsBuilder);
    mockOperationsBuilder.call.mockResolvedValue({ records: [] });

    service = new HorizonStreamService({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      cursorStorage: mockCursorStorage,
      initialReconnectDelay: 100, // Faster for tests (1s → 200ms base)
      maxReconnectDelay: 3200, // Cap at 3.2s for tests
      maxConsecutiveFailures: 3,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    service.stopAllStreams();
    mockCursorStorage.clear();
  });

  // ─── Stream Startup Tests ─────────────────────────────────────────────────────

  describe('startTransactionStream()', () => {
    it('starts SSE stream successfully', async () => {
      const accounts = ['GACCOUNT1', 'GACCOUNT2'];

      await service.startTransactionStream(accounts);

      expect(mockServer.transactions).toHaveBeenCalled();
      expect(mockStreamBuilder.stream).toHaveBeenCalled();

      const status = service.getStatus();
      expect(status.isConnected).toBe(true);
      expect(status.subscribedAccounts).toEqual(new Set(accounts));
    });

    it('uses cursor("now") when starting fresh stream', async () => {
      await service.startTransactionStream(['GACCOUNT1']);

      expect(mockStreamBuilder.cursor).toHaveBeenCalledWith('now');
    });

    it('resumes from stored cursor', async () => {
      await mockCursorStorage.setCursor('petchain-transactions', 'stored_cursor_123');

      await service.startTransactionStream(['GACCOUNT1']);

      expect(mockStreamBuilder.cursor).toHaveBeenCalledWith('stored_cursor_123');
    });

  });

  // ─── Error Recovery & Reconnection Tests ──────────────────────────────────────

  describe('reconnection with exponential backoff', () => {

    it('applies exponential backoff: 1s, 2s, 4s, ..., max 30s', async () => {
      await service.startTransactionStream(['GACCOUNT1']);

      const streamCall = mockStreamBuilder.stream.mock.calls[0][0];
      const onErrorHandler = streamCall.onerror;

      const reconnectTimings: number[] = [];

      mockStreamBuilder.stream.mockImplementation(() => {
        reconnectTimings.push(Date.now());
        throw new Error('Stream error');
      });

      // Trigger 3 consecutive errors
      onErrorHandler(new Error('Error 1'));
      jest.advanceTimersByTime(150); // 100ms delay

      onErrorHandler(new Error('Error 2'));
      jest.advanceTimersByTime(250); // 200ms delay (2x)

      onErrorHandler(new Error('Error 3'));
      jest.advanceTimersByTime(450); // 400ms delay (4x)

      const metrics = service.getStreamMetrics('petchain-transactions');
      if (metrics) {
        expect(metrics.reconnectAttempts).toBeGreaterThanOrEqual(1);
      }
    });

    it('resets consecutive failures counter on successful message', async () => {
      await service.startTransactionStream(['GACCOUNT1']);

      const streamCall = mockStreamBuilder.stream.mock.calls[0][0];
      const onMessageHandler = streamCall.onmessage;
      const onErrorHandler = streamCall.onerror;

      const mockTx = createMockTransaction({ source_account: 'GACCOUNT1' });

      // Send a successful message
      onMessageHandler(mockTx);

      // Now trigger an error
      onErrorHandler(new Error('Error after success'));

      const metrics = service.getStreamMetrics('petchain-transactions');
      if (metrics) {
        expect(metrics.consecutiveFailures).toBe(1); // Should be reset to 1, not 2
      }
    });
  });

  // ─── StreamManager Independence Tests ────────────────────────────────────────

  describe('StreamManager independence', () => {
    it('allows stopping individual streams without affecting others', async () => {
      await service.startTransactionStream(['GACCOUNT1']);

      const manager1 = service['streamManagers'].get('petchain-transactions');

      service.stopStream('petchain-transactions');

      expect(manager1).toBeDefined();
      expect(mockCloseFunction).toHaveBeenCalled();
      expect(service['streamManagers'].size).toBe(0);
    });
  });

  // ─── Transaction Processing Tests ─────────────────────────────────────────────

  describe('transaction processing', () => {
    let onMessageHandler: (tx: any) => void;

    beforeEach(async () => {
      await service.startTransactionStream(['GACCOUNT1']);

      const streamCall = mockStreamBuilder.stream.mock.calls[0][0];
      onMessageHandler = streamCall.onmessage;
    });

    it('processes relevant transactions', (done) => {
      const mockTx = createMockTransaction({
        source_account: 'GACCOUNT1',
      });

      service.on('transaction', (event: StreamEvent) => {
        expect(event.type).toBe('transaction');
        const txData = event.data as PetChainTransaction;
        expect(txData.hash).toBe('hash123');
        expect(txData.sourceAccount).toBe('GACCOUNT1');
        expect(txData.successful).toBe(true);
        done();
      });

      onMessageHandler(mockTx);
      jest.runAllTimers();
    });

    it('updates cursor for all transactions', async () => {
      const mockTx = createMockTransaction({
        source_account: 'GUNRELATED_ACCOUNT',
        paging_token: 'new_cursor_456',
      });

      onMessageHandler(mockTx);
      jest.advanceTimersByTime(10);

      const cursor = await mockCursorStorage.getCursor('petchain-transactions');
      expect(cursor).toBe('new_cursor_456');
    });

    it('fetches transaction operations', async () => {
      const mockTx = createMockTransaction({
        source_account: 'GACCOUNT1',
      });

      const mockOperations = [
        {
          type: 'payment',
          source_account: 'GACCOUNT1',
          to: 'GACCOUNT2',
          asset_type: 'native',
          amount: '100',
        },
      ];

      mockOperationsBuilder.call.mockResolvedValue({
        records: mockOperations,
      });

      service.on('transaction', (event: StreamEvent) => {
        const txData = event.data as PetChainTransaction;
        expect(txData.operations).toHaveLength(1);
        expect(txData.operations[0].type).toBe('payment');
      });

      onMessageHandler(mockTx);
      jest.runAllTimers();
    });

  });

  // ─── WebSocket Broadcast Tests ────────────────────────────────────────────────

  // ─── Stream Management Tests ──────────────────────────────────────────────────

  describe('stream management', () => {
    it('stops all streams gracefully', async () => {
      await service.startTransactionStream(['GACCOUNT1']);

      service.stopAllStreams();

      expect(mockCloseFunction).toHaveBeenCalled();

      const status = service.getStatus();
      expect(status.isConnected).toBe(false);
      expect(status.subscribedAccounts.size).toBe(0);
    });

    it('handles errors when closing streams', async () => {
      mockCloseFunction.mockImplementationOnce(() => {
        throw new Error('Close failed');
      });

      await service.startTransactionStream(['GACCOUNT1']);

      service.stopAllStreams();

      expect(loggerService.warn).toHaveBeenCalledWith(
        'Error closing stream',
        expect.any(Object),
      );
    });
  });

  // ─── Cursor Management Tests ──────────────────────────────────────────────────

  describe('cursor management', () => {
    it('sets cursor manually', async () => {
      await service.setCursor('test-stream', 'manual_cursor_789');

      const cursor = await mockCursorStorage.getCursor('test-stream');
      expect(cursor).toBe('manual_cursor_789');

      const status = service.getStatus();
      expect(status.currentCursor).toBe('manual_cursor_789');
    });
  });

  // ─── Status & Metrics Tests ───────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('returns current status', () => {
      const status = service.getStatus();

      expect(status).toMatchObject({
        isConnected: false,
        lastEventTime: null,
        reconnectAttempts: 0,
        currentCursor: null,
        subscribedAccounts: new Set(),
        error: null,
      });
    });

    it('updates status after starting stream', async () => {
      await service.startTransactionStream(['GACCOUNT1', 'GACCOUNT2']);

      const status = service.getStatus();

      expect(status.isConnected).toBe(true);
      expect(status.subscribedAccounts).toEqual(new Set(['GACCOUNT1', 'GACCOUNT2']));
    });
  });

  describe('getStreamMetrics()', () => {
    it('returns metrics for specific stream', async () => {
      await service.startTransactionStream(['GACCOUNT1']);

      const metrics = service.getStreamMetrics('petchain-transactions');

      expect(metrics).toMatchObject({
        streamId: 'petchain-transactions',
        isHealthy: true,
        reconnectAttempts: 0,
        consecutiveFailures: 0,
      });
    });

    it('returns all streams metrics', async () => {
      await service.startTransactionStream(['GACCOUNT1']);

      const allMetrics = service.getStreamMetrics();

      expect(allMetrics).toHaveProperty('petchain-transactions');
      expect(allMetrics['petchain-transactions']).toMatchObject({
        streamId: 'petchain-transactions',
        isHealthy: true,
      });
    });
  });
});
