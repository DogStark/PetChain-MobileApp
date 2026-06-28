/**
 * Integration service that connects blockchain events to app state updates
 * This demonstrates how to use the blockchain event service in a React Native app
 *
 * @remarks
 * This file is compiled with `strictNullChecks: true` (see tsconfig.strict.json).
 * All nullable types are explicitly annotated and every potential null access is
 * guarded. Do NOT add non-null assertions (`!`) without a comment explaining why
 * the assertion is safe.
 */

import { EventEmitter } from 'events';

import AsyncStorage from '@react-native-async-storage/async-storage';

import blockchainEventService, {
  type BlockchainEvent,
  type TransactionEvent,
  type VerificationUpdateEvent,
} from './blockchainEventService';
import {
  verifyRecordOnChain,
  invalidateBlockchainCacheKey,
  type StellarRecordVerification,
} from './blockchainService';
import { loggerService } from './loggerService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordVerificationStatus {
  recordId: string;
  verified: boolean;
  transactionHash?: string;
  ledger?: number;
  lastChecked: string;
  autoVerified: boolean; // True if verified via real-time events
}

export interface IntegrationConfig {
  autoConnect: boolean;
  verificationCheckInterval: number; // ms
  maxPendingVerifications: number;
}

export interface IntegrationStatus {
  connected: boolean;
  activeAccounts: string[];
  pendingVerifications: number;
  lastEventTime: number | null;
  error: string | null;
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const VERIFICATION_STATUS_KEY = '@blockchain_verification_status';
const PENDING_VERIFICATIONS_KEY = '@pending_verifications';
const INTEGRATION_CONFIG_KEY = '@blockchain_integration_config';

// ─── Default Configuration ────────────────────────────────────────────────────

const DEFAULT_CONFIG: IntegrationConfig = {
  autoConnect: true,
  verificationCheckInterval: 30000, // 30 seconds
  maxPendingVerifications: 100,
};

// ─── Blockchain Integration Service ───────────────────────────────────────────

export class BlockchainIntegrationService extends EventEmitter {
  private config: IntegrationConfig;
  private verificationStatuses = new Map<string, RecordVerificationStatus>();
  private pendingVerifications = new Set<string>();
  private verificationInterval: ReturnType<typeof setInterval> | null = null;
  private isInitialized = false;

  constructor(customConfig?: Partial<IntegrationConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.setupEventListeners();
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Initialize the integration service
   */
  async initialize(petChainAccounts: string[]): Promise<void> {
    if (this.isInitialized) {
      loggerService.debug('Blockchain integration already initialized');
      return;
    }

    try {
      loggerService.info('Initializing blockchain integration', {
        accounts: petChainAccounts,
        config: this.config,
      });

      // Load persisted data
      await this.loadPersistedData();

      // Connect to blockchain events if auto-connect is enabled
      if (this.config.autoConnect) {
        await blockchainEventService.connect(petChainAccounts);
      }

      // Start verification polling
      this.startVerificationPolling();

      this.isInitialized = true;

      loggerService.info('Blockchain integration initialized successfully');
      this.emit('initialized', { accounts: petChainAccounts });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Initialization failed';
      loggerService.error('Failed to initialize blockchain integration', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Add a record for verification monitoring
   */
  async addRecordForVerification(
    recordId: string,
    expectedHash?: string,
    transactionHash?: string,
  ): Promise<void> {
    try {
      loggerService.debug('Adding record for verification', {
        recordId,
        hasExpectedHash: !!expectedHash,
        transactionHash,
      });

      // Check if already verified
      const existingStatus = this.verificationStatuses.get(recordId);
      if (existingStatus?.verified) {
        loggerService.debug('Record already verified', { recordId });
        return;
      }

      // Add to pending verifications
      this.pendingVerifications.add(recordId);

      // Create initial status
      const status: RecordVerificationStatus = {
        recordId,
        verified: false,
        transactionHash,
        lastChecked: new Date().toISOString(),
        autoVerified: false,
      };

      this.verificationStatuses.set(recordId, status);

      // Persist changes
      await this.persistVerificationData();

      // Trigger immediate verification check if we have the expected hash
      if (expectedHash) {
        this.checkRecordVerification(recordId, expectedHash);
      }

      this.emit('recordAdded', { recordId, status });
    } catch (error) {
      loggerService.error('Failed to add record for verification', {
        recordId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get verification status for a record
   */
  getRecordVerificationStatus(recordId: string): RecordVerificationStatus | null {
    return this.verificationStatuses.get(recordId) || null;
  }

  /**
   * Get all verification statuses
   */
  getAllVerificationStatuses(): RecordVerificationStatus[] {
    return Array.from(this.verificationStatuses.values());
  }

  /**
   * Get current integration status
   */
  getStatus(): IntegrationStatus {
    const eventServiceStatus = blockchainEventService.getStatus();

    return {
      connected: eventServiceStatus.connected,
      activeAccounts: eventServiceStatus.subscribedAccounts,
      pendingVerifications: this.pendingVerifications.size,
      lastEventTime: eventServiceStatus.lastEventTime,
      error: eventServiceStatus.error,
    };
  }

  /**
   * Manually trigger verification check for a record
   */
  async checkRecordVerification(recordId: string, expectedHash: string): Promise<boolean> {
    try {
      loggerService.debug('Checking record verification', { recordId });

      const verification = await verifyRecordOnChain(recordId, expectedHash);

      await this.updateVerificationStatus(recordId, {
        verified: verification.verified,
        transactionHash: verification.txHash,
        ledger: verification.ledger,
        lastChecked: new Date().toISOString(),
        autoVerified: false, // Manual check
      });

      return verification.verified;
    } catch (error) {
      loggerService.error('Failed to check record verification', {
        recordId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Clear verification data
   */
  async clearVerificationData(): Promise<void> {
    this.verificationStatuses.clear();
    this.pendingVerifications.clear();

    await AsyncStorage.multiRemove([VERIFICATION_STATUS_KEY, PENDING_VERIFICATIONS_KEY]);

    loggerService.info('Verification data cleared');
    this.emit('dataCleared');
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    loggerService.info('Disconnecting blockchain integration');

    // Stop verification polling
    if (this.verificationInterval) {
      clearInterval(this.verificationInterval);
      this.verificationInterval = null;
    }

    // Disconnect event service
    blockchainEventService.disconnect();

    // Persist final state
    await this.persistVerificationData();

    this.isInitialized = false;
    this.emit('disconnected');
  }

  // ─── Private Methods ──────────────────────────────────────────────────────────

  private setupEventListeners(): void {
    // Listen for transaction events
    blockchainEventService.on('transaction', (event: BlockchainEvent) => {
      this.handleTransactionEvent(event.data as TransactionEvent);
    });

    // Listen for verification updates
    blockchainEventService.on('verificationUpdate', (event: BlockchainEvent) => {
      this.handleVerificationUpdate(event.data as VerificationUpdateEvent);
    });

    // Listen for connection status changes
    blockchainEventService.on('connectionStatus', (event: BlockchainEvent) => {
      this.emit('connectionStatus', event.data);
    });
  }

  private async handleTransactionEvent(transaction: TransactionEvent): Promise<void> {
    loggerService.debug('Handling transaction event', {
      hash: transaction.transactionHash,
      successful: transaction.successful,
      recordIds: transaction.recordIds,
    });

    // If transaction includes record IDs, update their verification status
    if (transaction.recordIds && transaction.successful) {
      for (const recordId of transaction.recordIds) {
        if (this.pendingVerifications.has(recordId)) {
          await this.updateVerificationStatus(recordId, {
            verified: true,
            transactionHash: transaction.transactionHash,
            ledger: transaction.ledger,
            lastChecked: new Date().toISOString(),
            autoVerified: true, // Verified via real-time event
          });

          // Remove from pending
          this.pendingVerifications.delete(recordId);

          // Invalidate cache for this record
          invalidateBlockchainCacheKey(`verify:${recordId}`);
        }
      }
    }

    this.emit('transactionProcessed', transaction);
  }

  private async handleVerificationUpdate(update: VerificationUpdateEvent): Promise<void> {
    loggerService.debug('Handling verification update', {
      recordId: update.recordId,
      verified: update.verified,
    });

    await this.updateVerificationStatus(update.recordId, {
      verified: update.verified,
      transactionHash: update.transactionHash,
      ledger: update.ledger,
      lastChecked: update.timestamp,
      autoVerified: true, // Verified via real-time event
    });

    if (update.verified) {
      this.pendingVerifications.delete(update.recordId);
    }

    this.emit('verificationUpdated', update);
  }

  private async updateVerificationStatus(
    recordId: string,
    updates: Partial<RecordVerificationStatus>,
  ): Promise<void> {
    const current = this.verificationStatuses.get(recordId) || {
      recordId,
      verified: false,
      lastChecked: new Date().toISOString(),
      autoVerified: false,
    };

    const updated = { ...current, ...updates };
    this.verificationStatuses.set(recordId, updated);

    // Persist changes
    await this.persistVerificationData();

    loggerService.debug('Updated verification status', { recordId, updates });
    this.emit('statusUpdated', { recordId, status: updated });
  }

  private startVerificationPolling(): void {
    if (this.verificationInterval) {
      clearInterval(this.verificationInterval);
    }

    this.verificationInterval = setInterval(() => {
      this.pollPendingVerifications();
    }, this.config.verificationCheckInterval);

    loggerService.debug('Started verification polling', {
      interval: this.config.verificationCheckInterval,
    });
  }

  private async pollPendingVerifications(): Promise<void> {
    if (this.pendingVerifications.size === 0) {
      return;
    }

    loggerService.debug('Polling pending verifications', {
      count: this.pendingVerifications.size,
    });

    // Check a subset of pending verifications to avoid overwhelming the API
    const toCheck = Array.from(this.pendingVerifications).slice(0, 5);

    for (const recordId of toCheck) {
      try {
        const status = this.verificationStatuses.get(recordId);
        if (!status) continue;

        // Skip if recently checked (within last 5 minutes)
        const lastChecked = new Date(status.lastChecked);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (lastChecked > fiveMinutesAgo) {
          continue;
        }

        // We need the expected hash to verify, but we don't have it stored
        // In a real implementation, you'd store the expected hash with the status
        // For now, we'll just update the lastChecked time
        await this.updateVerificationStatus(recordId, {
          lastChecked: new Date().toISOString(),
        });
      } catch (error) {
        loggerService.warn('Error during verification polling', {
          recordId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async loadPersistedData(): Promise<void> {
    try {
      const [statusData, pendingData] = await AsyncStorage.multiGet([
        VERIFICATION_STATUS_KEY,
        PENDING_VERIFICATIONS_KEY,
      ]);

      // Load verification statuses
      if (statusData[1]) {
        const statuses = JSON.parse(statusData[1]) as RecordVerificationStatus[];
        for (const status of statuses) {
          this.verificationStatuses.set(status.recordId, status);
        }
      }

      // Load pending verifications
      if (pendingData[1]) {
        const pending = JSON.parse(pendingData[1]) as string[];
        this.pendingVerifications = new Set(pending);
      }

      loggerService.debug('Loaded persisted verification data', {
        statusCount: this.verificationStatuses.size,
        pendingCount: this.pendingVerifications.size,
      });
    } catch (error) {
      loggerService.warn('Failed to load persisted verification data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async persistVerificationData(): Promise<void> {
    try {
      const statusArray = Array.from(this.verificationStatuses.values());
      const pendingArray = Array.from(this.pendingVerifications);

      await AsyncStorage.multiSet([
        [VERIFICATION_STATUS_KEY, JSON.stringify(statusArray)],
        [PENDING_VERIFICATIONS_KEY, JSON.stringify(pendingArray)],
      ]);
    } catch (error) {
      loggerService.warn('Failed to persist verification data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

export const blockchainIntegration = new BlockchainIntegrationService();

export default blockchainIntegration;
