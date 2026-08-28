/**
 * Unit tests for src/services/blockchainEventService.ts
 */

// ─── Mocks (must be declared before imports) ──────────────────────────────────

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    // Mock sending - in real tests you might want to capture sent messages
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: code || 1000, reason: reason || '' }));
    }
  }

  // Helper method for tests to simulate receiving messages
  simulateMessage(data: any): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  // Helper method for tests to simulate errors
  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

// Mock NetInfo
const mockNetInfoState = { isConnected: true };
const mockNetInfoListeners: Array<(state: any) => void> = [];

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((callback) => {
    mockNetInfoListeners.push(callback);
    return () => {
      const index = mockNetInfoListeners.indexOf(callback);
      if (index > -1) {
        mockNetInfoListeners.splice(index, 1);
      }
    };
  }),
}));

// Mock config
jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    isDev: true,
  },
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

// Set up global WebSocket mock
(global as any).WebSocket = MockWebSocket;

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  BlockchainEventService,
  type BlockchainEvent,
  type TransactionEvent,
  type VerificationUpdateEvent,
  type ConnectionStatusEvent,
} from '../blockchainEventService';

// ─── Test Setup ───────────────────────────────────────────────────────────────

describe('BlockchainEventService', () => {
  let service: BlockchainEventService;
  let mockWebSocket: MockWebSocket;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNetInfoListeners.length = 0;

    service = new BlockchainEventService({
      websocketUrl: 'ws://localhost:3001/test',
      reconnectDelay: 100, // Faster for tests
      maxReconnectAttempts: 3,
      heartbeatInterval: 1000,
      connectionTimeoutMs: 50, // Fast timeout for tests
    });

    // Capture the WebSocket instance created by the service
    const originalWebSocket = (global as any).WebSocket;
    (global as any).WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        mockWebSocket = this;
      }
    };
  });

  afterEach(() => {
    service.destroy();
  });

  // ─── Connection Tests ─────────────────────────────────────────────────────────

  describe('connect()', () => {
    it('establishes WebSocket connection successfully', async () => {
      const connectPromise = service.connect(['ACCOUNT1', 'ACCOUNT2']);

      // Wait for connection to complete
      await connectPromise;

      expect(service.getStatus().connected).toBe(true);
      expect(service.getStatus().subscribedAccounts).toEqual(['ACCOUNT1', 'ACCOUNT2']);
      expect(mockLogger.info).toHaveBeenCalledWith('Connected to blockchain events');
    });

    it('handles connection timeout', async () => {
      // Create a service with a very short timeout
      const timeoutService = new BlockchainEventService({
        websocketUrl: 'ws://localhost:3001/test',
        reconnectDelay: 99999,
        maxReconnectAttempts: 0, // no reconnect
        heartbeatInterval: 99999,
        connectionTimeoutMs: 20, // 20ms timeout
      });

      // Override WebSocket with one that never opens
      (global as any).WebSocket = class {
        readyState = 0;
        onopen: any = null;
        onclose: any = null;
        onmessage: any = null;
        onerror: any = null;
        constructor() {
          /* never fires onopen */
        }
        send() {}
        close() {}
      };

      await expect(timeoutService.connect()).rejects.toThrow('Connection timeout');
      timeoutService.destroy();
    });

    it('handles connection errors', async () => {
      // Override WebSocket with one that fires onerror via microtask
      (global as any).WebSocket = class {
        readyState = 0;
        onopen: any = null;
        onclose: any = null;
        onmessage: any = null;
        onerror: any = null;
        constructor() {
          Promise.resolve().then(() => {
            if (this.onerror) this.onerror(new Event('error'));
          });
        }
        send() {}
        close() {}
      };

      // Create a fresh service so the override is in effect
      const errorService = new BlockchainEventService({
        websocketUrl: 'ws://localhost:3001/test',
        reconnectDelay: 99999,
        maxReconnectAttempts: 0,
        heartbeatInterval: 99999,
        connectionTimeoutMs: 5000,
      });

      await expect(errorService.connect()).rejects.toThrow('WebSocket connection error');
      errorService.destroy();
    });

    it('does not reconnect if already connected', async () => {
      await service.connect();
      const firstStatus = service.getStatus();

      await service.connect();
      const secondStatus = service.getStatus();

      expect(firstStatus.connected).toBe(true);
      expect(secondStatus.connected).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith('Already connected to blockchain events');
    });
  });

  // ─── Disconnection Tests ──────────────────────────────────────────────────────

  describe('disconnect()', () => {
    it('disconnects cleanly', async () => {
      await service.connect();
      expect(service.getStatus().connected).toBe(true);

      service.disconnect();

      expect(service.getStatus().connected).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Manually disconnecting from blockchain events');
    });

    it('prevents automatic reconnection after manual disconnect', async () => {
      await service.connect();
      service.disconnect();

      // Simulate connection loss
      mockWebSocket.close(1006, 'Connection lost');

      // Wait a bit to see if reconnection is attempted
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(service.getStatus().connected).toBe(false);
      expect(service.getStatus().reconnectAttempts).toBe(0);
    });
  });

  // ─── Message Handling Tests ───────────────────────────────────────────────────

  describe('message handling', () => {
    beforeEach(async () => {
      await service.connect();
    });

    it('handles transaction events', (done) => {
      const mockTransaction = {
        type: 'transaction',
        data: {
          hash: 'tx123',
          sourceAccount: 'ACCOUNT1',
          successful: true,
          ledger: 12345,
          operationCount: 1,
          operations: [],
        },
        timestamp: '2023-01-01T00:00:00Z',
      };

      service.on('transaction', (event: BlockchainEvent) => {
        expect(event.type).toBe('transaction');
        const txData = event.data as TransactionEvent;
        expect(txData.transactionHash).toBe('tx123');
        expect(txData.sourceAccount).toBe('ACCOUNT1');
        expect(txData.successful).toBe(true);
        done();
      });

      mockWebSocket.simulateMessage(mockTransaction);
    });

    it('handles verification update events', (done) => {
      const mockVerification = {
        type: 'verification_update',
        data: {
          recordId: 'record123',
          verified: true,
          transactionHash: 'tx456',
          ledger: 12346,
          timestamp: '2023-01-01T00:00:00Z',
        },
        timestamp: '2023-01-01T00:00:00Z',
      };

      service.on('verificationUpdate', (event: BlockchainEvent) => {
        expect(event.type).toBe('verification_update');
        const verData = event.data as VerificationUpdateEvent;
        expect(verData.recordId).toBe('record123');
        expect(verData.verified).toBe(true);
        done();
      });

      mockWebSocket.simulateMessage(mockVerification);
    });

    it('handles status updates', () => {
      const mockStatus = {
        type: 'status',
        data: { connected: true, error: null },
      };

      mockWebSocket.simulateMessage(mockStatus);

      expect(mockLogger.debug).toHaveBeenCalledWith('Received status update', {
        status: { connected: true, error: null },
      });
    });

    it('handles pong messages', () => {
      const mockPong = { type: 'pong' };

      mockWebSocket.simulateMessage(mockPong);

      expect(mockLogger.debug).toHaveBeenCalledWith('Received heartbeat pong');
    });

    it('handles unknown message types', () => {
      const mockUnknown = { type: 'unknown_type' };

      mockWebSocket.simulateMessage(mockUnknown);

      expect(mockLogger.debug).toHaveBeenCalledWith('Unknown message type', {
        type: 'unknown_type',
      });
    });

    it('handles malformed messages', () => {
      // Simulate receiving invalid JSON
      if (mockWebSocket.onmessage) {
        mockWebSocket.onmessage(new MessageEvent('message', { data: 'invalid json' }));
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to parse WebSocket message',
        expect.objectContaining({
          data: 'invalid json',
        }),
      );
    });
  });

  // ─── Subscription Tests ───────────────────────────────────────────────────────

  describe('subscribeToAccounts()', () => {
    it('subscribes to accounts when connected', async () => {
      await service.connect();

      const sendSpy = jest.spyOn(mockWebSocket, 'send');

      service.subscribeToAccounts(['ACCOUNT1', 'ACCOUNT2']);

      expect(sendSpy).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'subscribe',
          accounts: ['ACCOUNT1', 'ACCOUNT2'],
        }),
      );

      expect(service.getStatus().subscribedAccounts).toEqual(['ACCOUNT1', 'ACCOUNT2']);
    });

    it('updates subscribed accounts when not connected', () => {
      service.subscribeToAccounts(['ACCOUNT3']);

      expect(service.getStatus().subscribedAccounts).toEqual(['ACCOUNT3']);
    });
  });

  // ─── Reconnection Tests ───────────────────────────────────────────────────────

  describe('reconnection', () => {
    it('attempts reconnection on connection loss', async () => {
      await service.connect();
      expect(service.getStatus().connected).toBe(true);

      // Simulate connection loss
      mockWebSocket.close(1006, 'Connection lost');

      expect(service.getStatus().connected).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Scheduling reconnection',
        expect.objectContaining({
          attempt: 1,
        }),
      );
    });

    it('stops reconnecting after max attempts', async () => {
      // Create service with low max attempts for testing
      const testService = new BlockchainEventService({
        maxReconnectAttempts: 2,
        reconnectDelay: 30,
        connectionTimeoutMs: 20,
      });

      // Mock WebSocket to always fail via onerror (microtask)
      (global as any).WebSocket = class {
        readyState = 0;
        onopen: any = null;
        onclose: any = null;
        onmessage: any = null;
        onerror: any = null;
        constructor() {
          Promise.resolve().then(() => {
            if (this.onerror) this.onerror(new Event('error'));
          });
        }
        send() {}
        close() {}
      };

      // Initial connect fails — scheduleReconnection is called
      try {
        await testService.connect();
      } catch {
        /* expected */
      }

      // Wait for 2 reconnect attempts to exhaust:
      // attempt 1: delay=30ms, attempt 2: delay=60ms → total ~120ms + buffer
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(testService.getStatus().error).toBe('Max reconnection attempts reached');

      testService.destroy();
    });
  });

  // ─── Network Monitoring Tests ─────────────────────────────────────────────────

  describe('network monitoring', () => {
    it('attempts reconnection when network comes back online', async () => {
      const connectSpy = jest.spyOn(service, 'connect');

      // Simulate network reconnection
      mockNetInfoListeners.forEach((listener) => {
        listener({ isConnected: true });
      });

      expect(connectSpy).toHaveBeenCalled();
    });
  });

  // ─── Status Tests ─────────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('returns current status', () => {
      const status = service.getStatus();

      expect(status).toMatchObject({
        connected: false,
        lastEventTime: null,
        reconnectAttempts: 0,
        error: null,
        subscribedAccounts: [],
      });
    });

    it('updates status after connection', async () => {
      await service.connect(['ACCOUNT1']);

      const status = service.getStatus();

      expect(status.connected).toBe(true);
      expect(status.subscribedAccounts).toEqual(['ACCOUNT1']);
    });
  });

  // ─── Record Verification Tests ────────────────────────────────────────────────

  describe('checkRecordVerification()', () => {
    it('returns verification result', async () => {
      const result = await service.checkRecordVerification('record123');

      expect(result).toMatchObject({
        recordId: 'record123',
        verified: true,
        transactionHash: 'mock-tx-hash',
        ledger: 12345,
      });
    });

    it('emits verification update event', (done) => {
      service.on('verificationUpdate', (event) => {
        expect(event.recordId).toBe('record456');
        done();
      });

      service.checkRecordVerification('record456');
    });
  });

  // ─── Cleanup Tests ────────────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('cleans up resources', async () => {
      await service.connect();

      const initialListenerCount = mockNetInfoListeners.length;

      service.destroy();

      expect(service.getStatus().connected).toBe(false);
      expect(mockNetInfoListeners.length).toBe(initialListenerCount - 1);
    });
  });
});
