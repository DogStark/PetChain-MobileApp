import apiClient from './apiClient';
import { executeSql, getItem, setItem } from './localDB';
import { sendAlertNotification } from './notificationService';
import syncService, { type SyncAction, type SyncEntityType, type SyncStatus } from './syncService';
import { networkMonitor } from '../utils/networkMonitor';

// ─── Blockchain anchor queue (SQLite-backed) ──────────────────────────────────

export interface BlockchainQueueItem {
  id: string;
  recordId: string;
  payload: string; // JSON-serialised record payload
  attempts: number;
  createdAt: string;
}

async function initBlockchainQueue(): Promise<void> {
  await executeSql(`
    CREATE TABLE IF NOT EXISTS blockchain_anchor_queue (
      id         TEXT PRIMARY KEY,
      record_id  TEXT NOT NULL,
      payload    TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
initBlockchainQueue().catch(() => {});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueuedMutation {
  id: string;
  type: SyncEntityType;
  action: SyncAction;
  data: Record<string, unknown>;
  timestamp: number;
  retries: number;
  nextRetryAt?: number;
  lastError?: string;
  /** ETag recorded when this mutation was created */
  etag?: string;
}

export interface ConflictItem {
  id: string;
  type: SyncEntityType;
  action: SyncAction;
  /** The offline change the user made */
  localData: Record<string, unknown>;
  /** The current server version */
  serverData: Record<string, unknown>;
}

export type ConflictResolution = 'keep-server' | 'keep-local';

export interface OfflineQueueStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSync: number | null;
  failedCount: number;
  exhaustedCount: number;
  nextRetryAt: number | null;
  /** Conflicts waiting for user resolution */
  pendingConflicts: ConflictItem[];
}

type StatusListener = (status: OfflineQueueStatus) => void;
type ConflictListener = (conflict: ConflictItem) => void;

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_KEY = '@offline_queue';
const CONFLICTS_KEY = '@offline_queue:conflicts';
const MAX_MUTATION_RETRIES = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 600_000;
const RETRY_JITTER_RATIO = 0.25;

// ─── OfflineQueue ─────────────────────────────────────────────────────────────

/**
 * OfflineQueue wraps SyncService to provide:
 *  - Automatic offline detection before mutations
 *  - Persistent queue via AsyncStorage
 *  - Auto-processing when connectivity is restored
 *  - User notifications for sync status changes
 */
class OfflineQueue {
  private statusListeners: StatusListener[] = [];
  private conflictListeners: ConflictListener[] = [];
  private isOnline = false;
  private initialized = false;
  private isConnectionExpensive = false;
  private pauseOnExpensiveNetwork = false;
  private processPromise: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Call once at app startup (e.g. in App.tsx).
   * Starts network monitoring and wires up auto-sync on reconnect.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Seed current online state
    const initialStatus = await networkMonitor.getStatus();
    this.isOnline = initialStatus.isOnline;
    this.isConnectionExpensive = initialStatus.isConnectionExpensive;

    // A single status subscription handles both reconnection and metered-network changes.
    networkMonitor.onStatusChange(async (status) => {
      const wasEligible = this.isNetworkEligible();
      this.isOnline = status.isOnline;
      this.isConnectionExpensive = status.isConnectionExpensive;

      if (!wasEligible && this.isNetworkEligible()) {
        await this.notifyUser('🔄 Back online', 'Syncing your offline changes…');
        await this.processQueue();
        await this.processBlockchainQueue();
      }

      await this.emitStatus();
    });

    // Keep legacy connectivity triggers; the in-flight guard coalesces duplicates.
    networkMonitor.setSyncCallback(() => this.processQueue());

    networkMonitor.startNetworkMonitoring();

    // Forward syncService status changes to our listeners
    syncService.onStatusChange((syncStatus: SyncStatus) => {
      this.emitStatusFromSync(syncStatus);
    });

    if (this.isNetworkEligible()) void this.processQueue();
  }

  configure(options: { pauseOnExpensiveNetwork?: boolean }): void {
    const wasEligible = this.isNetworkEligible();
    if (options.pauseOnExpensiveNetwork !== undefined) {
      this.pauseOnExpensiveNetwork = options.pauseOnExpensiveNetwork;
    }
    if (!wasEligible && this.isNetworkEligible()) void this.processQueue();
  }

  private isNetworkEligible(): boolean {
    return this.isOnline && !(this.pauseOnExpensiveNetwork && this.isConnectionExpensive);
  }

  private retryDelay(retries: number): number {
    const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, retries - 1));
    const jitter = (Math.random() * 2 - 1) * RETRY_JITTER_RATIO;
    return Math.min(RETRY_MAX_MS, Math.max(1, Math.round(base * (1 + jitter))));
  }

  private scheduleRetry(queue: QueuedMutation[]): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const retryAt = queue
      .filter((mutation) => mutation.retries < MAX_MUTATION_RETRIES && mutation.nextRetryAt)
      .reduce((next, mutation) => Math.min(next, mutation.nextRetryAt!), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(retryAt)) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processQueue();
    }, Math.max(0, retryAt - Date.now()));
  }

  // ── Enqueue a mutation ────────────────────────────────────────────────────

  /**
   * Queue a create/update/delete mutation.
   * If online, immediately attempts to process the queue.
   * If offline, persists to AsyncStorage for later.
   */
  async enqueue(
    type: SyncEntityType,
    action: SyncAction,
    data: Record<string, unknown>,
  ): Promise<void> {
    // Persist to our own queue key for resilience
    await this.persistToQueue({ type, action, data });

    // Also enqueue in syncService (which manages retries + conflicts)
    await syncService.enqueue(type, action, data);

    if (this.isOnline) {
      await this.processQueue();
    } else {
      await this.notifyUser(
        '📴 Saved offline',
        'Your change has been saved and will sync when you reconnect.',
      );
      await this.emitStatus();
    }
  }

  // ── Process the queue ─────────────────────────────────────────────────────

  /**
   * Flush all pending mutations to the server.
   * Detects 409 conflicts via If-Match / ETag and queues them for resolution.
   */
  async processQueue(): Promise<void> {
    if (this.processPromise) return this.processPromise;
    this.processPromise = this.processQueueInternal();
    try {
      await this.processPromise;
    } finally {
      this.processPromise = null;
    }
  }

  private async processQueueInternal(): Promise<void> {
    const status = await networkMonitor.getStatus();
    this.isOnline = status.isOnline;
    this.isConnectionExpensive = status.isConnectionExpensive;
    if (!this.isNetworkEligible()) return;

    const pending = await this.getPersistentQueue();
    if (pending.length === 0) return;

    const stillPending: QueuedMutation[] = [];
    const now = Date.now();

    for (const mutation of pending) {
      if (
        mutation.retries >= MAX_MUTATION_RETRIES ||
        (mutation.nextRetryAt !== undefined && mutation.nextRetryAt > now)
      ) {
        stillPending.push(mutation);
        continue;
      }

      try {
        const headers: Record<string, string> = {};
        if (mutation.etag) headers['If-Match'] = mutation.etag;
        headers['Idempotency-Key'] = `offline-${mutation.id}`;

        const endpoint = `/${mutation.type}s/${String(mutation.data.id ?? '')}`;
        const response = await apiClient.put(endpoint, mutation.data, { headers });

        // Capture updated ETag for future mutations on this entity
        const newEtag = (response.headers as Record<string, string>)?.['etag'];
        if (newEtag) {
          // Update stored ETag for subsequent mutations on the same entity
          const updated = stillPending.map((m) =>
            m.data.id === mutation.data.id ? { ...m, etag: newEtag } : m,
          );
          stillPending.splice(0, stillPending.length, ...updated);
        }
      } catch (err) {
        const status = (err as { response?: { status?: number; data?: unknown } })?.response
          ?.status;

        if (status === 409) {
          // Conflict detected — fetch server version and queue for resolution
          const serverData = await this._fetchServerVersion(mutation);
          if (serverData) {
            await this._storeConflict({
              id: mutation.id,
              type: mutation.type,
              action: mutation.action,
              localData: mutation.data,
              serverData,
            });
          } else {
            stillPending.push(this.scheduleMutationRetry(mutation, err));
          }
        } else {
          stillPending.push(this.scheduleMutationRetry(mutation, err));
        }
      }
    }

    await setItem(QUEUE_KEY, JSON.stringify(stillPending));
    this.scheduleRetry(stillPending);

    const conflicts = await this.getPendingConflicts();
    if (conflicts.length > 0) {
      await this.notifyUser(
        '⚠️ Sync conflict',
        `${conflicts.length} change(s) conflict with the server. Tap to resolve.`,
      );
    } else if (stillPending.length === 0) {
      await this.notifyUser('✅ Sync complete', 'All offline changes have been synced.');
    } else {
      const nextRetryAt = stillPending
        .filter((mutation) => mutation.nextRetryAt)
        .reduce((next, mutation) => Math.min(next, mutation.nextRetryAt!), Number.POSITIVE_INFINITY);
      const exhausted = stillPending.filter((mutation) => mutation.retries >= MAX_MUTATION_RETRIES);
      await this.notifyUser(
        '⚠️ Sync partially failed',
        exhausted.length > 0
          ? `${exhausted.length} change(s) reached the retry limit and remain saved.`
          : `${stillPending.length} change(s) could not be synced. Next retry in ${Math.max(1, Math.ceil((nextRetryAt - Date.now()) / 1000))} seconds.`,
      );
    }

    await this.emitStatus();
  }

  private scheduleMutationRetry(mutation: QueuedMutation, error: unknown): QueuedMutation {
    const retries = mutation.retries + 1;
    const lastError = error instanceof Error ? error.message : 'Unknown sync failure';
    return {
      ...mutation,
      retries,
      nextRetryAt:
        retries < MAX_MUTATION_RETRIES ? Date.now() + this.retryDelay(retries) : undefined,
      lastError,
    };
  }

  // ── Blockchain anchor queue ───────────────────────────────────────────────

  /**
   * Queue a medical record hash for Stellar anchoring.
   * Persists to SQLite so it survives app restarts.
   * If online, attempts to anchor immediately; otherwise retries on reconnect.
   */
  async queueBlockchainAnchor(recordId: string, payload: unknown): Promise<void> {
    const id = `${recordId}_${Date.now()}`;
    await executeSql(
      `INSERT OR REPLACE INTO blockchain_anchor_queue (id, record_id, payload, attempts)
       VALUES (?, ?, ?, 0)`,
      [id, recordId, JSON.stringify(payload)],
    );

    if (this.isOnline) {
      await this.processBlockchainQueue();
    } else {
      await this.notifyUser(
        '📴 Record saved offline',
        'Will anchor to blockchain when reconnected.',
      );
    }
  }

  /**
   * Flush all pending blockchain anchor jobs.
   * Called automatically on reconnect via initialize().
   */
  async processBlockchainQueue(): Promise<void> {
    const online = await networkMonitor.isOnline();
    if (!online) return;

    // Lazy import to avoid circular deps and keep mobile bundle lean
    const { default: apiClient } = await import('./apiClient');
    const db = (await import('expo-sqlite')).openDatabaseSync('petchain.db');

    const pending = db.getAllSync<BlockchainQueueItem>(
      `SELECT id, record_id AS recordId, payload, attempts, created_at AS createdAt
       FROM blockchain_anchor_queue WHERE attempts < 5 ORDER BY created_at ASC`,
    );

    for (const item of pending) {
      try {
        await apiClient.post('/api/anchor', {
          recordId: item.recordId,
          payload: JSON.parse(item.payload),
        });
        db.runSync(`DELETE FROM blockchain_anchor_queue WHERE id = ?`, [item.id]);
      } catch {
        db.runSync(`UPDATE blockchain_anchor_queue SET attempts = attempts + 1 WHERE id = ?`, [
          item.id,
        ]);
      }
    }

    if (pending.length > 0) {
      const remaining = db.getAllSync(`SELECT id FROM blockchain_anchor_queue WHERE attempts < 5`);
      if (remaining.length === 0) {
        await this.notifyUser('✅ Blockchain sync complete', 'All records anchored to Stellar.');
      }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async getStatus(): Promise<OfflineQueueStatus> {
    const syncStatus = await syncService.getStatus();
    const queue = await this.getPersistentQueue();
    const pendingConflicts = await this.getPendingConflicts();
    const retryTimes = queue
      .map((mutation) => mutation.nextRetryAt)
      .filter((retryAt): retryAt is number => retryAt !== undefined);
    return {
      isOnline: this.isOnline,
      pendingCount: Math.max(syncStatus.pendingCount, queue.length),
      isSyncing: syncStatus.isSyncing,
      lastSync: syncStatus.lastSync,
      failedCount: syncStatus.failedCount + queue.filter((mutation) => mutation.retries > 0).length,
      exhaustedCount: queue.filter((mutation) => mutation.retries >= MAX_MUTATION_RETRIES).length,
      nextRetryAt: retryTimes.length > 0 ? Math.min(...retryTimes) : null,
      pendingConflicts,
    };
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Subscribe to individual conflict events (fires when a conflict is detected
   * during background sync). If the user is not present, conflicts are queued
   * and available via getStatus().pendingConflicts on next foreground session.
   */
  onConflict(listener: ConflictListener): () => void {
    this.conflictListeners.push(listener);
    return () => {
      this.conflictListeners = this.conflictListeners.filter((l) => l !== listener);
    };
  }

  // ── Conflict resolution ───────────────────────────────────────────────────

  /**
   * Resolve a conflict detected during sync.
   * - 'keep-server': discards the local change, removes from queue.
   * - 'keep-local': forces the local version to the server (bypasses ETag check).
   * The decision is written to the audit trail.
   */
  async resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void> {
    const conflicts = await this.getPendingConflicts();
    const conflict = conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;

    if (resolution === 'keep-local') {
      // Re-enqueue without ETag so the server accepts the overwrite
      const { etag: _etag, ...dataWithoutEtag } = conflict.localData;
      try {
        await apiClient.put(
          `/${conflict.type}s/${String(conflict.localData.id ?? conflictId)}`,
          dataWithoutEtag,
        );
      } catch {
        // Non-fatal — will be retried via queue
      }
    }
    // 'keep-server': nothing to push; server version is already applied

    // Remove from pending conflicts
    const remaining = conflicts.filter((c) => c.id !== conflictId);
    await setItem(CONFLICTS_KEY, JSON.stringify(remaining));

    // Write to audit trail
    await this.writeAuditEntry(conflict, resolution);
    await this.emitStatus();
  }

  /**
   * Retrieve all conflicts waiting for user resolution.
   */
  async getPendingConflicts(): Promise<ConflictItem[]> {
    const raw = await getItem(CONFLICTS_KEY);
    return raw ? (JSON.parse(raw) as ConflictItem[]) : [];
  }

  // ── Persistent queue helpers ──────────────────────────────────────────────

  private async persistToQueue(
    mutation: Omit<QueuedMutation, 'id' | 'timestamp' | 'retries'>,
  ): Promise<void> {
    const queue = await this.getPersistentQueue();
    // Fetch current ETag for the entity so we can detect conflicts on push
    let etag: string | undefined;
    if (mutation.data.id) {
      try {
        const res = await apiClient.head(`/${mutation.type}s/${String(mutation.data.id)}`);
        etag = (res.headers as Record<string, string>)?.['etag'];
      } catch {
        /* no ETag available */
      }
    }
    const item: QueuedMutation = {
      id: `${mutation.type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...mutation,
      etag,
      timestamp: Date.now(),
      retries: 0,
    };
    queue.push(item);
    await setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  async getPersistentQueue(): Promise<QueuedMutation[]> {
    const stored = await getItem(QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  private async clearPersistentQueue(): Promise<void> {
    await setItem(QUEUE_KEY, JSON.stringify([]));
  }

  private async _fetchServerVersion(
    mutation: QueuedMutation,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await apiClient.get<Record<string, unknown>>(
        `/${mutation.type}s/${String(mutation.data.id ?? '')}`,
      );
      return res.data;
    } catch {
      return null;
    }
  }

  private async _storeConflict(conflict: ConflictItem): Promise<void> {
    const conflicts = await this.getPendingConflicts();
    const existing = conflicts.findIndex((c) => c.id === conflict.id);
    if (existing >= 0) conflicts[existing] = conflict;
    else conflicts.push(conflict);
    await setItem(CONFLICTS_KEY, JSON.stringify(conflicts));
    // Notify listeners (foreground)
    this.conflictListeners.forEach((l) => l(conflict));
  }

  private async writeAuditEntry(
    conflict: ConflictItem,
    resolution: ConflictResolution,
  ): Promise<void> {
    try {
      await apiClient.post('/audit/conflicts', {
        entityType: conflict.type,
        entityId: conflict.localData.id,
        resolution,
        localData: conflict.localData,
        serverData: conflict.serverData,
        resolvedAt: new Date().toISOString(),
      });
    } catch {
      /* audit trail is best-effort */
    }
  }

  // ── Notification helper ───────────────────────────────────────────────────

  private async notifyUser(title: string, body: string): Promise<void> {
    try {
      await sendAlertNotification(title, body, { source: 'offlineQueue' });
    } catch {
      // Notifications are best-effort; never block queue operations
    }
  }

  // ── Status emission ───────────────────────────────────────────────────────

  private async emitStatus(): Promise<void> {
    const status = await this.getStatus();
    this.statusListeners.forEach((l) => l(status));
  }

  private async emitStatusFromSync(syncStatus: SyncStatus): Promise<void> {
    const queue = await this.getPersistentQueue();
    const pendingConflicts = await this.getPendingConflicts();
    const retryTimes = queue
      .map((mutation) => mutation.nextRetryAt)
      .filter((retryAt): retryAt is number => retryAt !== undefined);
    const status: OfflineQueueStatus = {
      isOnline: this.isOnline,
      pendingCount: Math.max(syncStatus.pendingCount, queue.length),
      isSyncing: syncStatus.isSyncing,
      lastSync: syncStatus.lastSync,
      failedCount: syncStatus.failedCount + queue.filter((mutation) => mutation.retries > 0).length,
      exhaustedCount: queue.filter((mutation) => mutation.retries >= MAX_MUTATION_RETRIES).length,
      nextRetryAt: retryTimes.length > 0 ? Math.min(...retryTimes) : null,
      pendingConflicts,
    };
    this.statusListeners.forEach((l) => l(status));
  }
}

export { OfflineQueue };
export const offlineQueue = new OfflineQueue();
export default offlineQueue;
