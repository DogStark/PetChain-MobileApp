import { EventEmitter } from 'events';

import { type Horizon } from '@stellar/stellar-sdk';
import { WebSocket } from 'ws';

import config from '../config';
import { loggerService } from './loggerService';

// Support both the legacy top-level Server export (used in tests/mocks) and
// the current Horizon.Server namespace export.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _sdk = require('@stellar/stellar-sdk') as any;

const _StellarServer: new (url: string) => Horizon.Server =
  _sdk.Server ?? _sdk.Horizon?.Server ?? _sdk.default?.Horizon?.Server;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HorizonStreamConfig {
  horizonUrl: string;
  networkPassphrase: string;
  initialReconnectDelay: number; // Starting backoff (1s)
  maxReconnectDelay: number; // Cap (30s)
  maxConsecutiveFailures: number; // Failures before unhealthy (3)
  cursorStorage: CursorStorage;
}

export interface CursorStorage {
  getCursor(streamId: string): Promise<string | null>;
  setCursor(streamId: string, cursor: string): Promise<void>;
}

/**
 * StreamManager — manages a single SSE stream with reconnection logic
 */
export class StreamManager extends EventEmitter {
  private streamId: string;
  private closeFunction: (() => void) | null = null;
  private reconnectAttempts = 0;
  private consecutiveFailures = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isHealthy = true;

  constructor(
    private streamId_: string,
    private server: Horizon.Server,
    private cursorStorage: CursorStorage,
    private config: HorizonStreamConfig,
  ) {
    super();
    this.streamId = streamId_;
  }

  async start(cursor?: string | null): Promise<void> {
    try {
      const storedCursor = cursor || (await this.cursorStorage.getCursor(this.streamId));

      let streamBuilder: any;

      // Route to appropriate stream based on streamId
      if (this.streamId.includes('transactions')) {
        streamBuilder = this.server.transactions();
      } else if (this.streamId.includes('accounts')) {
        streamBuilder = this.server.accounts();
      } else {
        throw new Error(`Unknown stream type: ${this.streamId}`);
      }

      if (storedCursor) {
        streamBuilder = streamBuilder.cursor(storedCursor);
      } else {
        streamBuilder = streamBuilder.cursor('now');
      }

      this.closeFunction = streamBuilder.stream({
        onmessage: (message: any) => this.handleMessage(message),
        onerror: (error: any) => this.handleError(error),
      });

      this.reconnectAttempts = 0;
      this.consecutiveFailures = 0;
      this.isHealthy = true;

      loggerService.info('Stream started', {
        streamId: this.streamId,
        cursor: storedCursor || 'now',
      });

      this.emit('started');
    } catch (error) {
      loggerService.error('Failed to start stream', {
        streamId: this.streamId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.handleError(error);
    }
  }

  private handleMessage(message: any): void {
    this.consecutiveFailures = 0; // Reset on success
    this.emit('message', message);
  }

  private handleError(error: any): void {
    this.consecutiveFailures++;
    this.reconnectAttempts++;

    const errorMsg = error instanceof Error ? error.message : String(error);

    loggerService.error('Stream error', {
      streamId: this.streamId,
      error: errorMsg,
      consecutiveFailures: this.consecutiveFailures,
      reconnectAttempts: this.reconnectAttempts,
    });

    // Check if stream is unhealthy
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.isHealthy = false;
      this.emit('unhealthy', {
        streamId: this.streamId,
        error: errorMsg,
        consecutiveFailures: this.consecutiveFailures,
      });
      loggerService.error('Stream marked as unhealthy', {
        streamId: this.streamId,
      });
      return;
    }

    // Schedule reconnect
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.maxReconnectDelay,
    );

    loggerService.info('Scheduling stream reconnection', {
      streamId: this.streamId,
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimeout = setTimeout(async () => {
      try {
        const cursor = await this.cursorStorage.getCursor(this.streamId);
        await this.start(cursor);
      } catch (error) {
        loggerService.error('Reconnection attempt failed', {
          streamId: this.streamId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.handleError(error);
      }
    }, delay);
  }

  stop(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.closeFunction) {
      try {
        this.closeFunction();
        loggerService.debug('Stream closed', { streamId: this.streamId });
      } catch (error) {
        loggerService.warn('Error closing stream', {
          streamId: this.streamId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.closeFunction = null;
    }

    this.removeAllListeners();
  }

  isStreamHealthy(): boolean {
    return this.isHealthy;
  }

  getMetrics() {
    return {
      streamId: this.streamId,
      isHealthy: this.isHealthy,
      reconnectAttempts: this.reconnectAttempts,
      consecutiveFailures: this.consecutiveFailures,
    };
  }
}

export interface PetChainTransaction {
  id: string;
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  successful: boolean;
  operationCount: number;
  memo?: string;
  feeCharged: string | number;
  operations: Array<{
    type: string;
    sourceAccount?: string;
    destination?: string;
    asset?: string;
    amount?: string;
    data?: string;
  }>;
}

export interface StreamEvent {
  type: 'transaction' | 'ledger' | 'operation' | 'payment' | 'status';
  data:
    | PetChainTransaction
    | Horizon.ServerApi.LedgerRecord
    | Horizon.ServerApi.OperationRecord
    | Horizon.ServerApi.PaymentOperationRecord
    | StreamStatus;
  cursor: string;
  timestamp: string;
}

export interface StreamStatus {
  isConnected: boolean;
  lastEventTime: number | null;
  reconnectAttempts: number;
  currentCursor: string | null;
  subscribedAccounts: Set<string>;
  error: string | null;
}

// ─── Default Configuration ────────────────────────────────────────────────────

// Forward-declare so DEFAULT_CONFIG can reference it
class InMemoryCursorStorage implements CursorStorage {
  private cursors = new Map<string, string>();

  async getCursor(streamId: string): Promise<string | null> {
    return this.cursors.get(streamId) || null;
  }

  async setCursor(streamId: string, cursor: string): Promise<void> {
    this.cursors.set(streamId, cursor);
  }
}

const DEFAULT_CONFIG: HorizonStreamConfig = {
  horizonUrl: config.isDev ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org',
  networkPassphrase: config.isDev
    ? 'Test SDF Network ; September 2015'
    : 'Public Global Stellar Network ; September 2015',
  initialReconnectDelay: 1000, // 1 second
  maxReconnectDelay: 30000, // 30 seconds
  maxConsecutiveFailures: 3, // Unhealthy after 3 failures
  cursorStorage: new InMemoryCursorStorage(),
};

// ─── Horizon Stream Service ───────────────────────────────────────────────────

export class HorizonStreamService extends EventEmitter {
  private server: Horizon.Server;
  private config: HorizonStreamConfig;
  private status: StreamStatus;
  private streamManagers = new Map<string, StreamManager>();
  private webSocketClients = new Set<WebSocket>();

  constructor(customConfig?: Partial<HorizonStreamConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.server = new _StellarServer(this.config.horizonUrl);

    this.status = {
      isConnected: false,
      lastEventTime: null,
      reconnectAttempts: 0,
      currentCursor: null,
      subscribedAccounts: new Set(),
      error: null,
    };

    this.setupGracefulShutdown();
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Start streaming transactions using SSE (Server-Sent Events)
   * Replaces old polling-based approach
   */
  async startTransactionStream(accounts: string[]): Promise<void> {
    const streamId = 'petchain-transactions';

    try {
      this.status.subscribedAccounts = new Set(accounts);
      this.status.error = null;

      loggerService.info('Starting SSE transaction stream', {
        streamId,
        accounts,
        horizonUrl: this.config.horizonUrl,
      });

      const streamManager = new StreamManager(streamId, this.server, this.config.cursorStorage, this.config);

      // Attach listeners
      streamManager.on('message', (transaction) => {
        this.handleTransaction(streamId, transaction, accounts);
      });

      streamManager.on('unhealthy', (data) => {
        this.handleStreamUnhealthy(data);
      });

      streamManager.on('started', () => {
        this.status.isConnected = true;
        this.status.reconnectAttempts = 0;
      });

      this.streamManagers.set(streamId, streamManager);

      // Start the stream
      await streamManager.start();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.status.error = errorMsg;
      loggerService.error('Failed to start transaction stream', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Stop a specific stream
   */
  stopStream(streamId: string): void {
    const manager = this.streamManagers.get(streamId);
    if (manager) {
      manager.stop();
      this.streamManagers.delete(streamId);
      loggerService.info('Stream stopped', { streamId });
    }
  }

  /**
   * Stop all active streams
   */
  stopAllStreams(): void {
    loggerService.info('Stopping all SSE streams');

    for (const [streamId, manager] of this.streamManagers) {
      try {
        manager.stop();
        loggerService.debug('Closed stream', { streamId });
      } catch (error) {
        loggerService.warn('Error closing stream', { streamId, error });
      }
    }

    this.streamManagers.clear();

    this.status.isConnected = false;
    this.status.reconnectAttempts = 0;
    this.status.subscribedAccounts.clear();
  }

  /**
   * Add WebSocket client for real-time updates
   */
  addWebSocketClient(ws: WebSocket): void {
    this.webSocketClients.add(ws);

    this.sendToWebSocket(ws, {
      type: 'status',
      data: this.getStatus(),
      cursor: this.status.currentCursor || '',
      timestamp: new Date().toISOString(),
    });

    ws.on('close', () => {
      this.webSocketClients.delete(ws);
      loggerService.debug('WebSocket client disconnected');
    });

    ws.on('error', (error) => {
      this.webSocketClients.delete(ws);
      loggerService.warn('WebSocket client error', { error: error.message });
    });

    loggerService.debug('WebSocket client connected', {
      totalClients: this.webSocketClients.size,
    });
  }

  /**
   * Get current stream status
   */
  getStatus(): StreamStatus {
    return { ...this.status };
  }

  /**
   * Get stream manager metrics
   */
  getStreamMetrics(streamId?: string) {
    if (streamId) {
      return this.streamManagers.get(streamId)?.getMetrics();
    }

    const metrics: Record<string, any> = {};
    for (const [id, manager] of this.streamManagers) {
      metrics[id] = manager.getMetrics();
    }
    return metrics;
  }

  /**
   * Manually set cursor for stream resumption
   */
  async setCursor(streamId: string, cursor: string): Promise<void> {
    await this.config.cursorStorage.setCursor(streamId, cursor);
    this.status.currentCursor = cursor;
    loggerService.debug('Cursor updated', { streamId, cursor });
  }

  // ─── Private Methods ──────────────────────────────────────────────────────────

  private handleTransaction(
    streamId: string,
    transaction: Horizon.ServerApi.TransactionRecord,
    accounts: string[],
  ): void {
    try {
      const isRelevant = this.isTransactionRelevant(transaction, accounts);

      if (!isRelevant) {
        // Still update cursor
        this.config.cursorStorage.setCursor(streamId, transaction.paging_token);
        return;
      }

      // Transform to PetChain format
      this.transformAndBroadcastTransaction(transaction, streamId);
    } catch (error) {
      loggerService.error('Error handling transaction', {
        transactionHash: transaction.hash,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async transformAndBroadcastTransaction(
    transaction: Horizon.ServerApi.TransactionRecord,
    streamId: string,
  ): Promise<void> {
    try {
      const petChainTransaction = await this.transformTransaction(transaction);

      const streamEvent: StreamEvent = {
        type: 'transaction',
        data: petChainTransaction,
        cursor: transaction.paging_token,
        timestamp: new Date().toISOString(),
      };

      this.status.lastEventTime = Date.now();
      this.status.currentCursor = transaction.paging_token;

      this.config.cursorStorage.setCursor(streamId, transaction.paging_token);

      this.emit('transaction', streamEvent);
      this.broadcastToWebSockets(streamEvent);

      loggerService.debug('Transaction processed', {
        hash: transaction.hash,
        sourceAccount: transaction.source_account,
        successful: transaction.successful,
      });
    } catch (error) {
      loggerService.error('Failed to transform transaction', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private handleStreamUnhealthy(data: any): void {
    loggerService.error('Stream became unhealthy', data);
    this.emit('stream:unhealthy', data);
    this.status.isConnected = false;
    this.status.error = `Stream unhealthy: ${data.error}`;

    const event: StreamEvent = {
      type: 'status',
      data: {
        ...this.getStatus(),
        unhealthyStreamId: data.streamId,
      },
      cursor: this.status.currentCursor || '',
      timestamp: new Date().toISOString(),
    };

    this.broadcastToWebSockets(event);
  }

  private isTransactionRelevant(
    transaction: Horizon.ServerApi.TransactionRecord,
    accounts: string[],
  ): boolean {
    return accounts.includes(transaction.source_account);
  }

  private async transformTransaction(
    transaction: Horizon.ServerApi.TransactionRecord,
  ): Promise<PetChainTransaction> {
    const operations = await this.fetchTransactionOperations(transaction.hash);

    return {
      id: transaction.id,
      hash: transaction.hash,
      ledger: transaction.ledger_attr ?? 0,
      createdAt: transaction.created_at,
      sourceAccount: transaction.source_account,
      successful: transaction.successful,
      operationCount: transaction.operation_count,
      memo: transaction.memo,
      feeCharged: transaction.fee_charged,
      operations,
    };
  }

  private async fetchTransactionOperations(transactionHash: string): Promise<
    Array<{
      type: string;
      sourceAccount?: string;
      destination?: string;
      asset?: string;
      amount?: string;
      data?: string;
    }>
  > {
    try {
      const operationsPage = await this.server.operations().forTransaction(transactionHash).call();

      return operationsPage.records.map((op) => ({
        type: op.type,
        sourceAccount: op.source_account,
        ...(op.type === 'payment' && {
          destination: (op as any).to,
          asset: (op as any).asset_type,
          amount: (op as any).amount,
        }),
        ...(op.type === 'manage_data' && {
          data: (op as any).value,
        }),
      }));
    } catch (error) {
      loggerService.warn('Failed to fetch transaction operations', {
        transactionHash,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  private broadcastToWebSockets(event: StreamEvent): void {
    const message = JSON.stringify(event);
    const deadClients: WebSocket[] = [];

    for (const client of this.webSocketClients) {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        } else {
          deadClients.push(client);
        }
      } catch (error) {
        loggerService.warn('Failed to send to WebSocket client', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        deadClients.push(client);
      }
    }

    for (const client of deadClients) {
      this.webSocketClients.delete(client);
    }
  }

  private sendToWebSocket(ws: WebSocket, event: StreamEvent): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    } catch (error) {
      loggerService.warn('Failed to send to specific WebSocket client', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private setupGracefulShutdown(): void {
    const cleanup = () => {
      loggerService.info('Graceful shutdown: closing SSE streams');
      this.stopAllStreams();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

export const horizonStreamService = new HorizonStreamService();

export default horizonStreamService;
