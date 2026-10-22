import apiClient from './apiClient';
import { getItem, setItem } from './localDB';
import { networkMonitor } from '../utils/networkMonitor';

// ==============================
// TYPES
// ==============================

export type SyncEntityType = 'pet' | 'appointment' | 'medication' | 'medicalRecord';
export type SyncAction = 'create' | 'update' | 'delete';
export type ConflictResolutionStrategy = 'last-write-wins' | 'manual';

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
  localVersion?: string;
  serverVersion?: string;
  conflictingFields?: string[];
  autoMergedFields?: string[];
}

export interface ConflictResolution {
  entityId: string;
  type: SyncEntityType;
  /** Field-level choices: field name -> 'local' | 'remote' */
  fieldChoices: Record<string, 'local' | 'remote'>;
  resolvedAt: number;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSync: number | null;
  pendingCount: number;
  failedCount: number;
  conflicts: ConflictRecord[];
}

// ==============================
// CONSTANTS
// ==============================

const SYNC_QUEUE_KEY = '@sync_queue';
const SYNC_STATUS_KEY = '@sync_status';
const CONFLICTS_KEY = '@sync_conflicts';
const RESOLUTIONS_KEY = '@sync_resolutions';
const MAX_RETRIES = 3;

const DEFAULT_STATUS: SyncStatus = {
  isSyncing: false,
  lastSync: null,
  pendingCount: 0,
  failedCount: 0,
  conflicts: [],
};

// ==============================
// CLASS
// ==============================

export class SyncService {
  private statusListeners: Array<(status: SyncStatus) => void> = [];

  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  // ── Queue management ──
  async enqueue(
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

    if (existingIdx >= 0) queue[existingIdx] = item;
    else queue.push(item);

    await setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    await this.patchStatus({ pendingCount: queue.length });
  }

  // ── Pull from server ─────────────────────────────────────────────────────────

  async pull(
    types: SyncEntityType[] = ['pet', 'appointment', 'medication', 'medicalRecord'],
  ): Promise<void> {
    for (const type of types) {
      try {
        let endpoint = `/${type}s`;
        if (type === 'medicalRecord') {
          // For medical records, we might need a different pull strategy if they are nested.
          // Assuming there's a user-level endpoint or we pull per pet.
          // For now, let's try top-level /medical-records if available,
          // or skip if the API only supports nested.
          endpoint = '/medical-records';
        }

        const response = await apiClient.get<Record<string, unknown>[]>(endpoint);
        const serverItems = response.data;
        // Persist each item locally
        for (const item of serverItems) {
          const key = `@${type}_${item.id}`;
          const localRaw = await getItem(key);
          if (localRaw) {
            const local = JSON.parse(localRaw) as Record<string, unknown>;
            const resolved = await this.resolveConflict(type, local, item, 'manual');
            await setItem(key, JSON.stringify(resolved));
          } else {
            await setItem(key, JSON.stringify(item));
          }
        }
      } catch {
        // Non-fatal: continue with other types
      }
    }
  }

  // ── Push local changes ───────────────────────────────────────────────────────

  async push(): Promise<void> {
    const online = await networkMonitor.isOnline();
    if (!online) return;

    const status = await this.getStatus();
    if (status.isSyncing) return;

    await this.patchStatus({ isSyncing: true });

    const queue = await this.getQueue();
    const failed: SyncItem[] = [];

    for (const item of queue) {
      try {
        await this.syncItem(item);
      } catch {
        item.retries += 1;
        if (item.retries < MAX_RETRIES) failed.push(item);
      }
    }

    await setItem(SYNC_QUEUE_KEY, JSON.stringify(failed));

    await this.patchStatus({
      isSyncing: false,
      lastSync: Date.now(),
      pendingCount: failed.length,
      failedCount: failed.filter((i) => i.retries >= MAX_RETRIES).length,
    });
  }

  // ── Sync ──
  async sync(): Promise<void> {
    const online = await networkMonitor.isOnline();
    if (!online) return;

    await this.pull();
    await this.push();
  }

  // ── Conflict resolution ──
  async resolveConflict(
    type: SyncEntityType,
    localData: Record<string, unknown>,
    serverData: Record<string, unknown>,
    strategy: ConflictResolutionStrategy = 'manual',
  ): Promise<Record<string, unknown>> {
    const localVersion = this.getVersion(localData);
    const serverVersion = this.getVersion(serverData);

    // No version metadata on either side → nothing to compare, keep server.
    if (!localVersion && !serverVersion) {
      return serverData;
    }

    // Versions match → no concurrent edit, safe to take server.
    if (localVersion && serverVersion && localVersion === serverVersion) {
      return serverData;
    }

    // Explicit last-write-wins is only honored when the caller opts in.
    if (strategy === 'last-write-wins') {
      const localTs = (localData.updatedAt as number) || 0;
      const serverTs = (serverData.updatedAt as number) || 0;
      return serverTs >= localTs ? serverData : localData;
    }

    // Manual strategy: never silently overwrite. Auto-merge unchanged fields
    // and surface the remaining conflicting fields for user review.
    const { merged, conflictingFields, autoMergedFields } = this.mergeFields(
      localData,
      serverData,
    );

    if (conflictingFields.length > 0) {
      await this.recordConflict({
        entityId: (localData.id as string) || (serverData.id as string),
        type,
        localData,
        serverData,
        localTimestamp: (localData.updatedAt as number) || 0,
        serverTimestamp: (serverData.updatedAt as number) || 0,
        localVersion,
        serverVersion,
        conflictingFields,
        autoMergedFields,
      });
    }

    return merged;
  }

  /**
   * Field-aware merge. Fields that are identical on both sides (or only
   * present on one side) are merged automatically. Fields that differ are
   * reported as conflicting and left at the local value until the user
   * resolves them via the review screen.
   */
  private mergeFields(
    localData: Record<string, unknown>,
    serverData: Record<string, unknown>,
  ): {
    merged: Record<string, unknown>;
    conflictingFields: string[];
    autoMergedFields: string[];
  } {
    const merged: Record<string, unknown> = { ...serverData };
    const conflictingFields: string[] = [];
    const autoMergedFields: string[] = [];

    const keys = new Set([...Object.keys(localData), ...Object.keys(serverData)]);

    for (const key of keys) {
      if (key === 'version' || key === 'etag') continue;

      const hasLocal = Object.prototype.hasOwnProperty.call(localData, key);
      const hasServer = Object.prototype.hasOwnProperty.call(serverData, key);

      if (hasLocal && hasServer) {
        if (this.isEqual(localData[key], serverData[key])) {
          autoMergedFields.push(key);
        } else {
          conflictingFields.push(key);
          // Keep local value pending user review; never silently drop it.
          merged[key] = localData[key];
        }
      } else if (hasLocal) {
        merged[key] = localData[key];
        autoMergedFields.push(key);
      } else {
        autoMergedFields.push(key);
      }
    }

    return { merged, conflictingFields, autoMergedFields };
  }

  private isEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private getVersion(data: Record<string, unknown>): string | undefined {
    const version = data.version ?? data.etag;
    return version === undefined || version === null ? undefined : String(version);
  }

  // ── Conflict persistence & resolution ──

  async getConflicts(): Promise<ConflictRecord[]> {
    const stored = await getItem(CONFLICTS_KEY);
    return stored ? (JSON.parse(stored) as ConflictRecord[]) : [];
  }

  private async recordConflict(conflict: ConflictRecord): Promise<void> {
    const conflicts = await this.getConflicts();
    const idx = conflicts.findIndex(
      (c) => c.entityId === conflict.entityId && c.type === conflict.type,
    );
    if (idx >= 0) conflicts[idx] = conflict;
    else conflicts.push(conflict);

    await setItem(CONFLICTS_KEY, JSON.stringify(conflicts));
    await this.patchStatus({ conflicts });
  }

  /**
   * Apply a user's field-level resolution. Records the choice so it is
   * replay-safe, merges the chosen values, and clears the pending conflict.
   */
  async applyResolution(resolution: ConflictResolution): Promise<Record<string, unknown>> {
    const conflicts = await this.getConflicts();
    const conflict = conflicts.find(
      (c) => c.entityId === resolution.entityId && c.type === resolution.type,
    );

    if (!conflict) {
      throw new Error(`No pending conflict for ${resolution.type}:${resolution.entityId}`);
    }

    const merged: Record<string, unknown> = { ...conflict.serverData };
    for (const [field, choice] of Object.entries(resolution.fieldChoices)) {
      merged[field] = choice === 'local' ? conflict.localData[field] : conflict.serverData[field];
    }

    // Persist the resolved record locally.
    const key = `@${conflict.type}_${conflict.entityId}`;
    await setItem(key, JSON.stringify(merged));

    // Record the resolution for replay-safety.
    const stored = await getItem(RESOLUTIONS_KEY);
    const resolutions: ConflictResolution[] = stored ? JSON.parse(stored) : [];
    resolutions.push({ ...resolution, resolvedAt: Date.now() });
    await setItem(RESOLUTIONS_KEY, JSON.stringify(resolutions));

    // Clear the resolved conflict.
    const remaining = conflicts.filter(
      (c) => !(c.entityId === resolution.entityId && c.type === resolution.type),
    );
    await setItem(CONFLICTS_KEY, JSON.stringify(remaining));
    await this.patchStatus({ conflicts: remaining });

    return merged;
  }

  async getResolutions(): Promise<ConflictResolution[]> {
    const stored = await getItem(RESOLUTIONS_KEY);
    return stored ? (JSON.parse(stored) as ConflictResolution[]) : [];
  }

  // ── Helpers ──
  private async syncItem(item: SyncItem): Promise<void> {
    let endpoint = `/${item.type}s`;

    // Handle nested medical record endpoints
    if (item.type === 'medicalRecord') {
      const petId = item.data.petId as string;
      if (petId) {
        endpoint = `/pets/${petId}/medical-records`;
      } else {
        endpoint = '/medical-records';
      }
    }

    switch (item.action) {
      case 'create': {
        await apiClient.post(endpoint, item.data);
        break;
      }
      case 'update': {
        const id = item.data.id as string;
        await apiClient.put(`${endpoint}/${id}`, item.data);
        break;
      }
      case 'delete': {
        const delId = item.data.id as string;
        await apiClient.delete(`${endpoint}/${delId}`);
        break;
      }
    }
  }

  private async getQueue(): Promise<SyncItem[]> {
    const stored = await getItem(SYNC_QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  }

  async getStatus(): Promise<SyncStatus> {
    const stored = await getItem(SYNC_STATUS_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_STATUS;
  }

  private async patchStatus(updates: Partial<SyncStatus>): Promise<void> {
    const current = await this.getStatus();
    const next = { ...current, ...updates };

    await setItem(SYNC_STATUS_KEY, JSON.stringify(next));
    this.statusListeners.forEach((l) => l(next));
  }
}

// ==============================
// FIX FOR TESTS (IMPORTANT)
// ==============================

// 👉 THIS is what fixes:
// "SyncService is not a constructor"

export const createSyncService = () => new SyncService();

// Singleton for app usage
export const syncService = new SyncService();
export default syncService;
