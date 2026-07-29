/**
 * useOfflineSync
 *
 * Exposes the offline sync queue state and lets consumers manually trigger a
 * sync flush. Subscribes to {@link offlineQueue} status updates so the returned
 * values stay in sync with background network activity.
 *
 * Auto-sync on network reconnect is wired up by lazily calling
 * {@link offlineQueue.initialize} on mount. `initialize()` is idempotent
 * (guarded by an internal flag), so it's safe for any component using this
 * hook — and also if `App.tsx` already calls it at startup.
 *
 * @example
 * ```tsx
 * function SyncBanner() {
 *   const { pendingCount, isSyncing, lastSync, error, triggerSync } = useOfflineSync();
 *
 *   if (pendingCount === 0) return null;
 *
 *   return (
 *     <View>
 *       <Text>{isSyncing ? 'Syncing…' : `${pendingCount} pending changes`}</Text>
 *       {error && <Text style={{ color: 'red' }}>{error}</Text>}
 *       <Button title="Sync now" onPress={triggerSync} disabled={isSyncing} />
 *       {lastSync !== null && (
 *         <Text>Last synced: {new Date(lastSync).toLocaleTimeString()}</Text>
 *       )}
 *     </View>
 *   );
 * }
 * ```
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { offlineQueue, type OfflineQueueStatus } from '../services/offlineQueue';

// ─── Public API types ─────────────────────────────────────────────────────────

export interface UseOfflineSyncResult {
  /** True when the device has connectivity. Defaults to true until initialised. */
  isOnline: boolean;
  /** Number of mutations waiting to be flushed to the server. */
  pendingCount: number;
  /** True while a sync flush is in progress. */
  isSyncing: boolean;
  /** Unix timestamp (ms) of the last successful sync, or null if never synced. */
  lastSync: number | null;
  /**
   * Error message from the most recent failed sync attempt, or null when the
   * last attempt succeeded (or no attempt has been made yet).
   */
  error: string | null;
  /**
   * Imperatively flush the offline queue.
   * Safe to call even when online/offline state is uncertain — `offlineQueue`
   * will skip the network call if the device is currently offline.
   */
  triggerSync: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * React hook that exposes offline sync queue state and a manual sync trigger.
 *
 * The hook:
 * - Reads initial status from {@link offlineQueue} on mount.
 * - Subscribes to live status updates so the UI reflects network/sync changes
 *   in real-time (including auto-sync when the device reconnects).
 * - Tracks error state when a manual `triggerSync` call throws.
 * - Cleans up the subscription and prevents state updates after unmount.
 */
export function useOfflineSync(): UseOfflineSyncResult {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    // Ensure auto-sync-on-reconnect is wired up. initialize() is the (sole)
    // entry point that registers the network-reconnect callback; it is
    // idempotent, so calling it here (in addition to any startup call in
    // App.tsx) is safe.
    offlineQueue.initialize().catch(() => {
      // Initialization failures are non-fatal: the hook still works once the
      // queue reports status via getStatus() / onStatusChange().
    });

    // Apply a status snapshot atomically to avoid intermediate renders.
    const applyStatus = (status: OfflineQueueStatus): void => {
      if (!isMounted.current) return;
      setIsOnline(status.isOnline);
      setPendingCount(status.pendingCount);
      setIsSyncing(status.isSyncing);
      setLastSync(status.lastSync);
      // Clear stale errors when a sync completes successfully and there is
      // nothing left in the queue.
      if (!status.isSyncing && status.pendingCount === 0 && status.failedCount === 0) {
        setError(null);
      }
      // Surface a persistent error when failed items remain after syncing.
      if (!status.isSyncing && status.failedCount > 0) {
        setError(`${status.failedCount} item(s) failed to sync and will be retried.`);
      }
    };

    // Seed state from the current queue status asynchronously.
    offlineQueue
      .getStatus()
      .then(applyStatus)
      .catch(() => {});

    // Subscribe to live updates (network changes, background sync progress, etc.).
    const unsubscribe = offlineQueue.onStatusChange(applyStatus);

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, []);

  const triggerSync = useCallback(async (): Promise<void> => {
    if (!isMounted.current) return;
    try {
      setError(null);
      await offlineQueue.processQueue();
    } catch (err) {
      if (isMounted.current) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred during sync.';
        setError(message);
      }
    }
  }, []);

  return { isOnline, pendingCount, isSyncing, lastSync, error, triggerSync };
}

export default useOfflineSync;
