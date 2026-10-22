import { EventEmitter } from 'events';

import NetInfo from '@react-native-community/netinfo';

import config from '../config';
import { loggerService } from './loggerService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BlockchainEvent {
  type: 'transaction' | 'verification_update' | 'connection_status';
  data: TransactionEvent | VerificationUpdateEvent | ConnectionStatusEvent;
  timestamp: string;
}

export interface TransactionEvent {
  transactionHash: string;
  sourceAccount: string;
  successful: boolean;
  ledger: number;
  operationCount: number;
  memo?: string;
  operations: Array<{
    type: string;
    sourceAccount?: string;
    destination?: string;
    asset?: string;
    amount?: string;
    data?: string;
  }>;
  recordIds?: string[]; // PetChain record IDs affected by this transaction
}

export interface VerificationUpdateEvent {
  recordId: string;
  verified: boolean;
  transactionHash?: string;
  ledger?: number;
  timestamp: string;
}

export interface ConnectionStatusEvent {
  connected: boolean;
  error?: string;
  reconnectAttempts?: number;
}

export interface EventServiceConfig {
  websocketUrl: string;
  reconnectDelay: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  connectionTimeoutMs: number;
}

export interface EventServiceStatus {
  connected: boolean;
  lastEventTime: number | null;
  reconnectAttempts: number;
  error: string | null;
  subscribedAccounts: string[];
}

// ─── Default Configuration ────────────────────────────────────────────────────

const DEFAULT_CONFIG: EventServiceConfig = {
  websocketUrl: config.isDev
    ? 'ws://localhost:3001/blockchain-events'
    : 'wss://api.petchain.app/blockchain-events',
  reconnectDelay: 3000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
  connectionTimeoutMs: 10000,
};

// ─── Blockchain Event Service ─────────────────────────────────────────────────

export class BlockchainEventService extends EventEmitter {
  private config: EventServiceConfig;
  private websocket: WebSocket | null = null;
  private status: EventServiceStatus;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isManuallyDisconnected = false;
  private networkListener: (() => void) | null = null;

  constructor(customConfig?: Partial<EventServiceConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...customConfig };

    this.status = {
      connected: false,
      lastEventTime: null,
      reconnectAttempts: 0,
      error: null,
      subscribedAccounts: [],
    };

    this.setupNetworkMonitoring();
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Connect to the blockchain event stream
   */
  async connect(accounts: string[] = []): Promise<void> {
    if (this.websocket !== null && this.websocket.readyState === 1 /* OPEN */) {
      loggerService.debug('Already connected to blockchain events');
      return;
    }

    this.isManuallyDisconnected = false;
    this.status.subscribedAccounts = accounts;

    try {
      await this.createWebSocketConnection();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      this.status.error = errorMessage;
      loggerService.error('Failed to connect to blockchain events', { error: errorMessage });
      // Schedule reconnection if this was not a manual disconnect
      if (!this.isManuallyDisconnected) {
        this.scheduleReconnection();
      }
      throw error;
    }
  }

  /**
   * Disconnect from the blockchain event stream
   */
  disconnect(): void {
    loggerService.info('Manually disconnecting from blockchain events');

    this.isManuallyDisconnected = true;
    this.clearReconnectTimeout();
    this.clearHeartbeat();

    if (this.websocket) {
      this.websocket.close(1000, 'Manual disconnect');
      this.websocket = null;
    }

    this.updateConnectionStatus(false);
  }

  /**
   * Subscribe to events for specific accounts
   */
  subscribeToAccounts(accounts: string[]): void {
    this.status.subscribedAccounts = accounts;

    if (this.websocket !== null && this.websocket.readyState === 1 /* OPEN */) {
      this.sendMessage({
        type: 'subscribe',
        accounts,
      });

      loggerService.debug('Subscribed to accounts', { accounts });
    }
  }

  /**
   * Get current service status
   */
  getStatus(): EventServiceStatus {
    return { ...this.status };
  }

  /**
   * Check if a record verification update is available
   */
  async checkRecordVerification(recordId: string): Promise<VerificationUpdateEvent | null> {
    try {
      // This would typically make an API call to check verification status
      // For now, we'll emit a mock event to demonstrate the flow
      const verificationEvent: VerificationUpdateEvent = {
        recordId,
        verified: true, // This would come from actual verification
        transactionHash: 'mock-tx-hash',
        ledger: 12345,
        timestamp: new Date().toISOString(),
      };

      this.emit('verificationUpdate', verificationEvent);
      return verificationEvent;
    } catch (error) {
      loggerService.error('Failed to check record verification', {
        recordId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  // ─── Private Methods ──────────────────────────────────────────────────────────

  private async createWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        loggerService.info('Connecting to blockchain events', {
          url: this.config.websocketUrl,
          accounts: this.status.subscribedAccounts,
        });

        // Declare timeout handle first so closures can reference it
        // eslint-disable-next-line prefer-const
        let timeoutHandle: ReturnType<typeof setTimeout>;
        let settled = false;

        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          fn();
        };

        this.websocket = new WebSocket(this.config.websocketUrl);

        this.websocket.onopen = () => {
          settle(() => {
            loggerService.info('Connected to blockchain events');
            this.updateConnectionStatus(true);
            this.status.reconnectAttempts = 0;
            this.status.error = null;
            if (this.status.subscribedAccounts.length > 0) {
              this.subscribeToAccounts(this.status.subscribedAccounts);
            }
            this.startHeartbeat();
            resolve();
          });
        };

        this.websocket.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.websocket.onclose = (event) => {
          this.handleDisconnection(event);
        };

        this.websocket.onerror = (error) => {
          settle(() => {
            const errorMessage = 'WebSocket connection error';
            loggerService.error(errorMessage, { error });
            this.status.error = errorMessage;
            this.updateConnectionStatus(false);
            reject(new Error(errorMessage));
          });
        };

        // Connection timeout — rejects if WebSocket never opens
        timeoutHandle = setTimeout(() => {
          settle(() => {
            this.websocket?.close();
            reject(new Error('Connection timeout'));
          });
        }, this.config.connectionTimeoutMs);
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      this.status.lastEventTime = Date.now();

      switch (message.type) {
        case 'transaction':
          this.handleTransactionEvent(message);
          break;

        case 'verification_update':
          this.handleVerificationUpdate(message);
          break;

        case 'status':
          this.handleStatusUpdate(message);
          break;

        case 'pong':
          // Heartbeat response
          loggerService.debug('Received heartbeat pong');
          break;

        default:
          loggerService.debug('Unknown message type', { type: message.type });
      }
    } catch (error) {
      loggerService.error('Failed to parse WebSocket message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        data: event.data,
      });
    }
  }

  private handleTransactionEvent(message: any): void {
    const transactionEvent: TransactionEvent = {
      transactionHash: message.data.hash,
      sourceAccount: message.data.sourceAccount,
      successful: message.data.successful,
      ledger: message.data.ledger,
      operationCount: message.data.operationCount,
      memo: message.data.memo,
      operations: message.data.operations || [],
      recordIds: message.data.recordIds,
    };

    const blockchainEvent: BlockchainEvent = {
      type: 'transaction',
      data: transactionEvent,
      timestamp: message.timestamp || new Date().toISOString(),
    };

    loggerService.debug('Received transaction event', {
      hash: transactionEvent.transactionHash,
      successful: transactionEvent.successful,
      recordIds: transactionEvent.recordIds,
    });

    this.emit('transaction', blockchainEvent);
    this.emit('event', blockchainEvent);
  }

  private handleVerificationUpdate(message: any): void {
    const verificationEvent: VerificationUpdateEvent = {
      recordId: message.data.recordId,
      verified: message.data.verified,
      transactionHash: message.data.transactionHash,
      ledger: message.data.ledger,
      timestamp: message.data.timestamp || new Date().toISOString(),
    };

    const blockchainEvent: BlockchainEvent = {
      type: 'verification_update',
      data: verificationEvent,
      timestamp: message.timestamp || new Date().toISOString(),
    };

    loggerService.debug('Received verification update', {
      recordId: verificationEvent.recordId,
      verified: verificationEvent.verified,
    });

    this.emit('verificationUpdate', blockchainEvent);
    this.emit('event', blockchainEvent);
  }

  private handleStatusUpdate(message: any): void {
    loggerService.debug('Received status update', { status: message.data });
  }

  private handleDisconnection(event: CloseEvent): void {
    loggerService.info('Disconnected from blockchain events', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });

    this.clearHeartbeat();
    this.updateConnectionStatus(false);
    this.websocket = null;

    // Don't reconnect if manually disconnected
    if (this.isManuallyDisconnected) {
      return;
    }

    // Attempt reconnection
    this.scheduleReconnection();
  }

  private scheduleReconnection(): void {
    if (this.status.reconnectAttempts >= this.config.maxReconnectAttempts) {
      loggerService.error('Max reconnection attempts reached');
      this.status.error = 'Max reconnection attempts reached';
      return;
    }

    this.status.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.status.reconnectAttempts - 1);

    loggerService.info('Scheduling reconnection', {
      attempt: this.status.reconnectAttempts,
      delay,
    });

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;

      try {
        await this.createWebSocketConnection();
      } catch (error) {
        loggerService.error('Reconnection failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Schedule next attempt — onclose may not fire if connection never opened
        this.scheduleReconnection();
      }
    }, delay) as unknown as NodeJS.Timeout;
  }

  private updateConnectionStatus(connected: boolean): void {
    const wasConnected = this.status.connected;
    this.status.connected = connected;

    if (wasConnected !== connected) {
      const statusEvent: ConnectionStatusEvent = {
        connected,
        error: this.status.error || undefined,
        reconnectAttempts: this.status.reconnectAttempts,
      };

      const blockchainEvent: BlockchainEvent = {
        type: 'connection_status',
        data: statusEvent,
        timestamp: new Date().toISOString(),
      };

      this.emit('connectionStatus', blockchainEvent);
      this.emit('event', blockchainEvent);
    }
  }

  private sendMessage(message: any): void {
    if (this.websocket !== null && this.websocket.readyState === 1 /* OPEN */) {
      this.websocket.send(JSON.stringify(message));
    } else {
      loggerService.warn('Cannot send message: WebSocket not connected');
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      this.sendMessage({ type: 'ping' });
    }, this.config.heartbeatInterval) as unknown as NodeJS.Timeout;
  }

  private clearHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private setupNetworkMonitoring(): void {
    this.networkListener = NetInfo.addEventListener((state) => {
      if (state.isConnected && !this.status.connected && !this.isManuallyDisconnected) {
        loggerService.info('Network reconnected, attempting to reconnect to blockchain events');
        this.connect(this.status.subscribedAccounts).catch((error) => {
          loggerService.error('Failed to reconnect after network recovery', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      }
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disconnect();

    if (this.networkListener) {
      this.networkListener();
      this.networkListener = null;
    }

    this.removeAllListeners();
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

export const blockchainEventService = new BlockchainEventService();

export default blockchainEventService;
