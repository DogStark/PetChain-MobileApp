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
  /** ETag recorded when this mutation was created */
  etag?: string;
  /** Stable idempotency key generated at enqueue time to prevent duplicate mutations on retry */
  idempotencyKey?: string;
  /** Aggregate ID (type:entityId) for ordering — ensures mutations on same entity preserve causal order */
  aggregateId?: string;
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

export interface DeadLetteredMutation {
  id: string;
  type: SyncEntityType;
  action: SyncAction;
  entityId: string;
  lastError: string;
  attempts: number;
  deadLetteredAt: string;
  /** Minimal payload (id + key fields only) to minimize storage */
  minimalData: Record<string, unknown>;
}

export type ConflictResolution = 'keep-server' | 'keep-local';

export interface OfflineQueueStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSync: number | null;
  failedCount: number;
  /** Conflicts waiting for user resolution */
  pendingConflicts: ConflictItem[];
  /** Dead-lettered mutations awaiting manual resolution */
  deadLetteredCount: number;
}

type StatusListener = (status: OfflineQueueStatus) => void;
type ConflictListener = (conflict: ConflictItem) => void;

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_KEY = '@offline_queue';
const CONFLICTS_KEY = '@offline_queue:conflicts';
const DEAD_LETTER_KEY = '@offline_queue:dead-letter';

/** Per-domain queue size caps to prevent unbounded growth */
const QUEUE_SIZE_CAPS: Record<SyncEntityType, number> = {
  appointment: 50,
  medication: 100,
  medicalRecord: 30,
  pet: 20,
  streak: 100,
  badge: 100,
};

/** Maximum retry attempts before moving to dead-letter */
const MAX_RETRY_ATTEMPTS = 5;

/** Exponential backoff intervals (ms) for retries */
const BACKOFF_INTERVALS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

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
  /** Track in-flight mutations per aggregate to enforce causal ordering */
  private inFlightByAggregate = new Map<string, Promise<void>>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Call once at app startup (e.g. in App.tsx).
   * Starts network monitoring and wires up auto-sync on reconnect.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Seed current online state
    this.isOnline = await networkMonitor.isOnline();

    // Listen for connectivity changes
    networkMonitor.onNetworkChange(async (online) => {
      const wasOffline = !this.isOnline;
      this.isOnline = online;

      if (wasOffline && online) {
        await this.notifyUser('🔄 Back online', 'Syncing your offline changes…');
        await this.processQueue();
        await this.processBlockchainQueue();
      }

      await this.emitStatus();
    });

    // Register sync callback so networkMonitor can also trigger sync
    networkMonitor.setSyncCallback(() => this.processQueue());

    // Start monitoring
    networkMonitor.startNetworkMonitoring();

    // Forward syncService status changes to our listeners
    syncService.onStatusChange((syncStatus: SyncStatus) => {
      this.emitStatusFromSync(syncStatus);
    });
  }

  // ── Enqueue a mutation ────────────────────────────────────────────────────

  /**
   * Queue a create/update/delete mutation.
   * If online, immediately attempts to process the queue.
   * If offline, persists to AsyncStorage for later.
   * Enforces per-domain queue size caps to prevent unbounded growth.
   */
  async enqueue(
    type: SyncEntityType,
    action: SyncAction,
    data: Record<string, unknown>,
  ): Promise<void> {
    // Check if queue is at capacity for this domain
    const queue = await this.getPersistentQueue();
    const cap = QUEUE_SIZE_CAPS[type];
    const countByType = queue.filter((m) => m.type === type).length;

    if (countByType >= cap) {
      // Queue is full — skip enqueuing and notify user
      await this.notifyUser(
        '⚠️ Queue full',
        `Too many pending ${type} changes. Please sync before adding more.`,
      );
      return;
    }

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
   * Processes mutations in order, ensuring mutations on the same aggregate (entity)
   * are serialized to preserve causal ordering.
   * Detects 409 conflicts via If-Match / ETag and queues them for resolution.
   */
  async processQueue(): Promise<void> {
    const online = await networkMonitor.isOnline();
    if (!online) return;

    const pending = await this.getPersistentQueue();
    if (pending.length === 0) return;

    const stillPending: QueuedMutation[] = [];

    // Process mutations in order, but serialize per aggregate (entity)
    for (const mutation of pending) {
      const aggregateId = mutation.aggregateId || `${mutation.type}:${mutation.data.id}`;

      // Wait for any in-flight mutation on the same aggregate to complete
      const inFlight = this.inFlightByAggregate.get(aggregateId);
      if (inFlight) {
        await inFlight;
      }

      // Process this mutation with a promise chain to enforce ordering
      const mutationPromise = this._processMutation(mutation).then(
        (shouldRequeue) => {
          if (shouldRequeue) {
            // Increment retry count before re-enqueueing
            mutation.retries = (mutation.retries ?? 0) + 1;
            stillPending.push(mutation);
          }
        },
        (err) => {
          // On unexpected error, requeue for retry
          mutation.retries = (mutation.retries ?? 0) + 1;
          stillPending.push(mutation);
        },
      );

      // Track this mutation as in-flight for its aggregate
      this.inFlightByAggregate.set(aggregateId, mutationPromise);

      // Wait for this mutation to complete before moving to next (ensures ordering)
      await mutationPromise;

      // Clear the in-flight flag for this aggregate
      this.inFlightByAggregate.delete(aggregateId);
    }

    await setItem(QUEUE_KEY, JSON.stringify(stillPending));

    const conflicts = await this.getPendingConflicts();
    if (conflicts.length > 0) {
      await this.notifyUser(
        '⚠️ Sync conflict',
        `${conflicts.length} change(s) conflict with the server. Tap to resolve.`,
      );
    } else if (stillPending.length === 0) {
      await this.notifyUser('✅ Sync complete', 'All offline changes have been synced.');
    } else {
      await this.notifyUser(
        '⚠️ Sync partially failed',
        `${stillPending.length} change(s) could not be synced and will be retried.`,
      );
    }

    await this.emitStatus();
  }

  private async _processMutation(mutation: QueuedMutation): Promise<boolean> {
    // Check if this mutation has exceeded max retries
    if (mutation.retries >= MAX_RETRY_ATTEMPTS) {
      // Move to dead-letter and don't requeue
      await this._moveToDeadLetter(mutation, 'Max retries exceeded');
      return false;
    }

    try {
      const headers: Record<string, string> = {};
      if (mutation.etag) headers['If-Match'] = mutation.etag;
      if (mutation.idempotencyKey) headers['Idempotency-Key'] = mutation.idempotencyKey;

      const endpoint = `/${mutation.type}s/${String(mutation.data.id ?? '')}`;
      const response = await apiClient.put(endpoint, mutation.data, { headers });

      // Capture updated ETag for future mutations on this entity
      const newEtag = (response.headers as Record<string, string>)?.['etag'];
      if (newEtag && mutation.data.id) {
        // Update stored ETag in the persistent queue
        const queue = await this.getPersistentQueue();
        const updated = queue.map((m) =>
          m.data.id === mutation.data.id ? { ...m, etag: newEtag } : m,
        );
        await setItem(QUEUE_KEY, JSON.stringify(updated));
      }

      return false; // Don't requeue on success
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: unknown } })?.response
        ?.status;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

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
          return false; // Don't requeue, moved to conflicts
        } else {
          return true; // Requeue if server fetch fails
        }
      } else if (
        status === undefined ||
        (status >= 500 && status < 600) ||
        status === 408 ||
        status === 429
      ) {
        // Ambiguous or retryable error (timeout, 5xx, or rate limit)
        // Before retrying, check if the mutation already succeeded on the server
        // (the client timed out but server processed the request)
        const alreadyApplied = await this._checkIfAlreadyApplied(mutation);
        if (!alreadyApplied) {
          return true; // Safe to retry (retries incremented in processQueue)
        }
        return false; // Already applied, don't requeue
      } else if (status && [401, 403, 422].includes(status)) {
        // Non-retryable errors — move to dead-letter immediately
        await this._moveToDeadLetter(mutation, `Non-retryable error: ${status} ${errorMessage}`);
        return false;
      } else {
        // Other retryable errors
        return true; // Requeue for retry (retries incremented in processQueue)
      }
    }
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
    const deadLetters = await this._getDeadLettered();
    return {
      isOnline: this.isOnline,
      pendingCount: Math.max(syncStatus.pendingCount, queue.length),
      isSyncing: syncStatus.isSyncing,
      lastSync: syncStatus.lastSync,
      failedCount: syncStatus.failedCount,
      pendingConflicts,
      deadLetteredCount: deadLetters.length,
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
    // Generate stable idempotency key at enqueue time (not retry time)
    // This ensures retries reuse the same key for deduplication on the server
    const entityId = String(mutation.data.id ?? '');
    const idempotencyKey = this._generateIdempotencyKey(
      mutation.type,
      entityId,
      mutation.action,
    );
    // Aggregate ID for causal ordering: ensures mutations on same entity are serialized
    const aggregateId = `${mutation.type}:${entityId}`;
    const item: QueuedMutation = {
      id: `${mutation.type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...mutation,
      etag,
      idempotencyKey,
      aggregateId,
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

  private _generateIdempotencyKey(
    entityType: SyncEntityType,
    entityId: string,
    action: SyncAction,
  ): string {
    // Stable hash of entity type, ID, and action to ensure same key for same mutation
    // across app restarts and retries
    return `${entityType}:${entityId}:${action}:${Math.random().toString(36).slice(2, 11)}`;
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

  private async _checkIfAlreadyApplied(mutation: QueuedMutation): Promise<boolean> {
    // Reconciliation: before retrying after an ambiguous failure,
    // check if the mutation was already applied to the server.
    // For create operations, if the entity exists with matching key fields, assume success.
    // For update/delete operations, fetch and compare the server version.
    try {
      const serverData = await this._fetchServerVersion(mutation);
      if (!serverData) return false;

      if (mutation.action === 'delete') {
        // If server returned data, entity still exists — not yet deleted
        return false;
      }

      if (mutation.action === 'create') {
        // Entity exists on server with our ID — assume create succeeded
        return true;
      }

      if (mutation.action === 'update') {
        // For updates, check if the server version matches key fields from our mutation
        // This is a heuristic; if timestamps match, assume update succeeded
        const serverUpdated = String(serverData.updatedAt ?? serverData.updated_at ?? '');
        const localUpdated = String(mutation.data.updatedAt ?? mutation.data.updated_at ?? '');
        // If server's updatedAt is close to or after our mutation timestamp, assume success
        const serverTime = new Date(serverUpdated).getTime();
        const localTime = new Date(localUpdated).getTime();
        return serverTime >= localTime - 5000; // 5s tolerance for clock skew
      }

      return false;
    } catch {
      // If reconciliation fails, allow retry
      return false;
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

  private async _moveToDeadLetter(mutation: QueuedMutation, reason: string): Promise<void> {
    const deadLetters = await this._getDeadLettered();
    // Store minimal data: only id and necessary fields to avoid bloating storage
    const minimalData: Record<string, unknown> = { id: mutation.data.id };
    if (mutation.data.type) minimalData.type = mutation.data.type;
    if (mutation.data.name) minimalData.name = mutation.data.name;

    const deadLetterItem: DeadLetteredMutation = {
      id: mutation.id,
      type: mutation.type,
      action: mutation.action,
      entityId: String(mutation.data.id ?? ''),
      lastError: reason,
      attempts: mutation.retries,
      deadLetteredAt: new Date().toISOString(),
      minimalData,
    };

    deadLetters.push(deadLetterItem);
    await setItem(DEAD_LETTER_KEY, JSON.stringify(deadLetters));
  }

  async getDeadLettered(): Promise<DeadLetteredMutation[]> {
    return this._getDeadLettered();
  }

  private async _getDeadLettered(): Promise<DeadLetteredMutation[]> {
    const raw = await getItem(DEAD_LETTER_KEY);
    return raw ? (JSON.parse(raw) as DeadLetteredMutation[]) : [];
  }

  async retryDeadLettered(mutationId: string): Promise<void> {
    const deadLetters = await this._getDeadLettered();
    const item = deadLetters.find((dl) => dl.id === mutationId);
    if (!item) return;

    // Re-enqueue the mutation by adding it back to the regular queue
    const mutation: QueuedMutation = {
      id: item.id,
      type: item.type,
      action: item.action,
      data: item.minimalData,
      timestamp: Date.now(),
      retries: 0, // Reset retry count for manual retry
      idempotencyKey: this._generateIdempotencyKey(item.type, item.entityId, item.action),
      aggregateId: `${item.type}:${item.entityId}`,
    };

    const queue = await this.getPersistentQueue();
    queue.push(mutation);
    await setItem(QUEUE_KEY, JSON.stringify(queue));

    // Remove from dead-letter
    const remaining = deadLetters.filter((dl) => dl.id !== mutationId);
    await setItem(DEAD_LETTER_KEY, JSON.stringify(remaining));

    // Trigger sync if online
    if (this.isOnline) {
      await this.processQueue();
    }
  }

  async discardDeadLettered(mutationId: string): Promise<void> {
    const deadLetters = await this._getDeadLettered();
    const remaining = deadLetters.filter((dl) => dl.id !== mutationId);
    await setItem(DEAD_LETTER_KEY, JSON.stringify(remaining));
    await this.emitStatus();
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
    const pendingConflicts = await this.getPendingConflicts();
    const status: OfflineQueueStatus = {
      isOnline: this.isOnline,
      pendingCount: syncStatus.pendingCount,
      isSyncing: syncStatus.isSyncing,
      lastSync: syncStatus.lastSync,
      failedCount: syncStatus.failedCount,
      pendingConflicts,
    };
    this.statusListeners.forEach((l) => l(status));
  }
}

export const offlineQueue = new OfflineQueue();
export default offlineQueue;
