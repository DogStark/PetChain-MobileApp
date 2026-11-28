import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStorageUsage, clearCacheByCategory, StorageCategory } from './storageService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncEntityType = 'pet' | 'appointment' | 'medication' | 'medicalRecord';
export type SyncAction = 'create' | 'update' | 'delete';
export type ConflictResolutionStrategy = 'last-write-wins' | 'manual';

/** Minimal typed API client shape used by sync operations */
export interface ApiClientLike {
  post: (url: string, data?: unknown) => Promise<{ data: unknown }>;
  put: (url: string, data?: unknown) => Promise<{ data: unknown }>;
  delete: (url: string) => Promise<{ data: unknown }>;
  get: (url: string) => Promise<{ data: unknown }>;
}

export interface SyncItem {
  id: string;
  type: SyncEntityType;
  action: SyncAction;
  data: Record<string, unknown>;
  timestamp: number;
  retries: number;
}

export interface ConflictRecord {
  entityId: string;
  type: SyncEntityType;
  localData: Record<string, unknown>;
  serverData: Record<string, unknown>;
  localTimestamp: number;
  serverTimestamp: number;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSync: number | null;
  pendingCount: number;
  failedCount: number;
  conflicts: ConflictRecord[];
}

export interface StorageUsageSummary {
  mediaBytes: number;
  recordsBytes: number;
  totalBytes: number;
  draftCount: number;
  unsyncedDraftCount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SYNC_QUEUE_KEY = '@sync_queue';
const SYNC_STATUS_KEY = '@sync_status';
const CONFLICTS_KEY = '@sync_conflicts';
const MAX_RETRIES = 3;
const DRAFTS_KEY = '@user_drafts';

const DEFAULT_STATUS: SyncStatus = {
  isSyncing: false,
  lastSync: null,
  pendingCount: 0,
  failedCount: 0,
  conflicts: [],
};

// ─── SyncService ──────────────────────────────────────────────────────────────

class SyncService {
  private statusListeners: Array<(status: SyncStatus) => void> = [];

  // ── Storage usage & cache cleanup ────────────────────────────────────────────

  // ── Queue management ─────────────────────────────────────────────────────────

  async addToQueue(
    type: SyncEntityType,
    action: SyncAction,
    data: Record<string, unknown>,
  ): Promise<void> {
    const queue = await this.getQueue();

    const entityId = data.id as string | undefined;
    const existingIdx = entityId
      ? queue.findIndex((i) => i.data.id === entityId && i.type === type && i.action === action)
      : -1;

    const item: SyncItem = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      action,
      data,
      timestamp: Date.now(),
      retries: 0,
    };

    if (existingIdx >= 0) {
      queue[existingIdx] = item;
    } else {
      queue.push(item);
    }

    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    await this.patchStatus({ pendingCount: queue.length });
  }

  // ── Push local changes to server ─────────────────────────────────────────────

  async sync(apiClient: {
    post: ApiClientLike['post'];
    put: ApiClientLike['put'];
    delete: ApiClientLike['delete'];
    get: ApiClientLike['get'];
  }): Promise<void> {
    const status = await this.getStatus();
    if (status.isSyncing) return;

    await this.patchStatus({ isSyncing: true });

    const queue = await this.getQueue();
    const failed: SyncItem[] = [];

    for (const item of queue) {
      try {
        await this.syncItem(item, apiClient);
      } catch {
        item.retries += 1;
        if (item.retries < MAX_RETRIES) {
          failed.push(item);
        }
      }
    }

    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(failed));
    await this.patchStatus({
      isSyncing: false,
      lastSync: Date.now(),
      pendingCount: failed.length,
      failedCount: failed.filter((i) => i.retries >= MAX_RETRIES).length,
    });
  }

  // ── Process offline queue (alias for sync, guards against double-run) ─────

  async processQueue(apiClient: {
    post: ApiClientLike['post'];
    put: ApiClientLike['put'];
    delete: ApiClientLike['delete'];
    get: ApiClientLike['get'];
  }): Promise<{ processed: number; failed: number }> {
    const queue = await this.getQueue();
    if (queue.length === 0) return { processed: 0, failed: 0 };

    await this.sync(apiClient);

    const remaining = await this.getQueue();
    return {
      processed: queue.length - remaining.length,
      failed: remaining.length,
    };
  }

  // ── Pull from server ─────────────────────────────────────────────────────────

  async pull(
    apiClient: { get: ApiClientLike['get'] },
    types: SyncEntityType[] = ['pet', 'appointment', 'medication'],
  ): Promise<void> {
    for (const type of types) {
      try {
        const response = await apiClient.get(`/${type}s`);
        const serverItems = response.data as Record<string, unknown>[];

        for (const item of serverItems) {
          const key = `@${type}_${item.id}`;
          const localRaw = await AsyncStorage.getItem(key);
          if (localRaw) {
            const local = JSON.parse(localRaw) as Record<string, unknown>;
            const resolved = await this.handleConflict(local, item);
            await AsyncStorage.setItem(key, JSON.stringify(resolved));
          } else {
            await AsyncStorage.setItem(key, JSON.stringify(item));
          }
        }
      } catch {
        // Non-fatal: continue with other types
      }
    }
  }

  // ── Conflict resolution ──────────────────────────────────────────────────────

  async handleConflict(
    localData: Record<string, unknown>,
    serverData: Record<string, unknown>,
    strategy: ConflictResolutionStrategy = 'last-write-wins',
  ): Promise<Record<string, unknown>> {
    const localTs = (localData.updatedAt as number) || (localData.timestamp as number) || 0;
    const serverTs = (serverData.updatedAt as number) || (serverData.timestamp as number) || 0;

    if (strategy === 'last-write-wins') {
      return serverTs >= localTs ? serverData : localData;
    }

    // Manual: store conflict for later resolution
    const conflict: ConflictRecord = {
      entityId: (localData.id as string) || '',
      type: 'pet', // caller should pass type; defaulting here
      localData,
      serverData,
      localTimestamp: localTs,
      serverTimestamp: serverTs,
    };
    await this.addConflict(conflict);
    return serverData;
  }

  async getConflicts(): Promise<ConflictRecord[]> {
    const stored = await AsyncStorage.getItem(CONFLICTS_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  async resolveManualConflict(
    entityId: string,
    resolution: 'local' | 'server',
    apiClient?: { put: ApiClientLike['put'] },
  ): Promise<void> {
    const conflicts = await this.getConflicts();
    const conflict = conflicts.find((c) => c.entityId === entityId);
    if (!conflict) return;

    const resolved = resolution === 'local' ? conflict.localData : conflict.serverData;
    const key = `@${conflict.type}_${entityId}`;
    await AsyncStorage.setItem(key, JSON.stringify(resolved));

    if (resolution === 'local' && apiClient) {
      await apiClient.put(`/${conflict.type}s/${entityId}`, resolved);
    }

    await this.removeConflict(entityId);
  }

  // ── Status ───────────────────────────────────────────────────────────────────

  async getStatus(): Promise<SyncStatus> {
    const stored = await AsyncStorage.getItem(SYNC_STATUS_KEY);
    const status: SyncStatus = stored ? JSON.parse(stored) : { ...DEFAULT_STATUS };
    status.conflicts = await this.getConflicts();
    return status;
  }

  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Returns a breakdown of cached media vs. records plus unsynchronized draft
   * counts. Drafts are surfaced separately so the UI can warn before cleanup.
   */
  async getStorageUsage(): Promise<StorageUsageSummary> {
    const usage = await getStorageUsage();
    const drafts = await this.getDrafts();
    const unsyncedDraftCount = drafts.filter((d) => !d.synced).length;
    return {
      mediaBytes: usage.mediaBytes,
      recordsBytes: usage.recordsBytes,
      totalBytes: usage.mediaBytes + usage.recordsBytes,
      draftCount: drafts.length,
      unsyncedDraftCount,
    };
  }

  /**
   * Selectively clears cached data by category. Unsynchronized user-authored
   * drafts are always preserved regardless of the requested category.
   */
  async clearCache(categories: StorageCategory[]): Promise<StorageUsageSummary> {
    const safeCategories = categories.filter((c) => c !== 'drafts');
    if (safeCategories.length > 0) {
      await clearCacheByCategory(safeCategories);
    }
    return this.getStorageUsage();
  }

  /**
   * Clears all cache categories except drafts. Used by the "clear all" action.
   */
  async clearAllCache(): Promise<StorageUsageSummary> {
    return this.clearCache(['media', 'records']);
  }

  async getDrafts(): Promise<Array<{ id: string; synced: boolean; data: Record<string, unknown> }>> {
    const stored = await AsyncStorage.getItem(DRAFTS_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  async saveDraft(id: string, data: Record<string, unknown>): Promise<void> {
    const drafts = await this.getDrafts();
    const idx = drafts.findIndex((d) => d.id === id);
    const draft = { id, synced: false, data };
    if (idx >= 0) drafts[idx] = draft;
    else drafts.push(draft);
    await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  }

  async markDraftSynced(id: string): Promise<void> {
    const drafts = await this.getDrafts();
    const idx = drafts.findIndex((d) => d.id === id);
    if (idx < 0) return;
    drafts[idx] = { ...drafts[idx], synced: true };
    await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  }

  async clearQueue(): Promise<void> {
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify([]));
    await this.patchStatus({ pendingCount: 0, failedCount: 0 });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async syncItem(
    item: SyncItem,
    apiClient: {
      post: ApiClientLike['post'];
      put: ApiClientLike['put'];
      delete: ApiClientLike['delete'];
    },
  ): Promise<void> {
    const endpoint = `/${item.type}s`;
    switch (item.action) {
      case 'create':
        await apiClient.post(endpoint, item.data);
        break;
      case 'update':
        await apiClient.put(`${endpoint}/${item.data.id}`, item.data);
        break;
      case 'delete':
        await apiClient.delete(`${endpoint}/${item.data.id}`);
        break;
    }
  }

  private async getQueue(): Promise<SyncItem[]> {
    const stored = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  private async patchStatus(updates: Partial<SyncStatus>): Promise<void> {
    const current = await this.getStatus();
    const next = { ...current, ...updates };
    await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(next));
    this.statusListeners.forEach((l) => l(next));
  }

  private async addConflict(conflict: ConflictRecord): Promise<void> {
    const conflicts = await this.getConflicts();
    const idx = conflicts.findIndex((c) => c.entityId === conflict.entityId);
    if (idx >= 0) conflicts[idx] = conflict;
    else conflicts.push(conflict);
    await AsyncStorage.setItem(CONFLICTS_KEY, JSON.stringify(conflicts));
  }

  private async removeConflict(entityId: string): Promise<void> {
    const conflicts = await this.getConflicts();
    await AsyncStorage.setItem(
      CONFLICTS_KEY,
      JSON.stringify(conflicts.filter((c) => c.entityId !== entityId)),
    );
  }
}

export default new SyncService();
