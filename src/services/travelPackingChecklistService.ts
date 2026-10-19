import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import NetInfo from '@react-native-community/netinfo';

import { offlineQueue, SyncEntity } from './offlineQueue';
import { withRetry } from '../utils/withRetry';
import { apiClient } from './apiClient';

export type PackingCategory = 'food' | 'records' | 'medication' | 'equipment';

export interface PackingItem {
  id: string;
  category: PackingCategory;
  label: string;
  notes?: string;
  packed: boolean;
  updatedAt: number;
}

export interface TravelPackingChecklist {
  petId: string;
  tripId: string;
  items: PackingItem[];
  updatedAt: number;
}

export type PermissionResult =
  | { granted: true }
  | { granted: false; reason: 'denied' | 'unauthenticated' | 'error' };

const DB_NAME = 'petchain.db';
const TABLE = 'travel_packing_checklists';
const CACHE_PREFIX = 'travelPackingChecklist:';
const SYNC_ENTITY: SyncEntity = 'travelPackingChecklist';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          petId TEXT NOT NULL,
          tripId TEXT NOT NULL,
          payload TEXT NOT NULL,
          updatedAt INTEGER NOT NULL,
          PRIMARY KEY (petId, tripId)
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

function cacheKey(petId: string, tripId: string): string {
  return `${CACHE_PREFIX}${petId}:${tripId}`;
}

function isValidChecklist(value: unknown): value is TravelPackingChecklist {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.petId === 'string' &&
    typeof v.tripId === 'string' &&
    Array.isArray(v.items) &&
    typeof v.updatedAt === 'number'
  );
}

function normalizeChecklist(raw: unknown): TravelPackingChecklist | null {
  if (!isValidChecklist(raw)) return null;
  return {
    petId: raw.petId,
    tripId: raw.tripId,
    updatedAt: raw.updatedAt,
    items: raw.items
      .filter((item): item is PackingItem => {
        if (!item || typeof item !== 'object') return false;
        const i = item as Record<string, unknown>;
        return (
          typeof i.id === 'string' &&
          typeof i.category === 'string' &&
          typeof i.label === 'string' &&
          typeof i.packed === 'boolean' &&
          typeof i.updatedAt === 'number'
        );
      })
      .map((item) => ({
        id: item.id,
        category: item.category,
        label: item.label,
        notes: typeof item.notes === 'string' ? item.notes : undefined,
        packed: item.packed,
        updatedAt: item.updatedAt,
      })),
  };
}

/**
 * Loads the checklist for a pet/trip, preferring SQLite and falling back to
 * the AsyncStorage cache. Returns null when nothing is stored locally.
 */
export async function loadChecklist(
  petId: string,
  tripId: string,
): Promise<TravelPackingChecklist | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ payload: string }>(
      `SELECT payload FROM ${TABLE} WHERE petId = ? AND tripId = ?`,
      [petId, tripId],
    );
    if (row?.payload) {
      const parsed = normalizeChecklist(JSON.parse(row.payload));
      if (parsed) return parsed;
    }
  } catch {
    // Fall through to cache on any SQLite error.
  }

  try {
    const cached = await AsyncStorage.getItem(cacheKey(petId, tripId));
    if (cached) {
      return normalizeChecklist(JSON.parse(cached));
    }
  } catch {
    // Ignore cache read errors.
  }

  return null;
}

async function writeLocal(checklist: TravelPackingChecklist): Promise<void> {
  const payload = JSON.stringify(checklist);
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO ${TABLE} (petId, tripId, payload, updatedAt)
       VALUES (?, ?, ?, ?)`,
      [checklist.petId, checklist.tripId, payload, checklist.updatedAt],
    );
  } catch {
    // Continue to cache write even if SQLite fails.
  }
  try {
    await AsyncStorage.setItem(
      cacheKey(checklist.petId, checklist.tripId),
      payload,
    );
  } catch {
    // Ignore cache write errors.
  }
}

/**
 * Persists the checklist locally first, then (only when online and the
 * server-confirmed permission check passes) enqueues an UPDATE for sync.
 */
export async function saveChecklist(
  checklist: TravelPackingChecklist,
): Promise<{ queued: boolean; permissionDenied: boolean }> {
  const normalized: TravelPackingChecklist = {
    ...checklist,
    updatedAt: checklist.updatedAt || Date.now(),
  };

  await writeLocal(normalized);

  let online = false;
  try {
    const state = await NetInfo.fetch();
    online = Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    online = false;
  }

  if (!online) {
    return { queued: false, permissionDenied: false };
  }

  const permission = await checkPermission(normalized.petId);
  if (!permission.granted) {
    return { queued: false, permissionDenied: true };
  }

  try {
    await offlineQueue.enqueue({
      entity: SYNC_ENTITY,
      operation: 'UPDATE',
      payload: {
        petId: normalized.petId,
        tripId: normalized.tripId,
        updatedAt: normalized.updatedAt,
        itemCount: normalized.items.length,
        packedCount: normalized.items.filter((i) => i.packed).length,
        items: normalized.items,
      },
    });
    return { queued: true, permissionDenied: false };
  } catch {
    return { queued: false, permissionDenied: false };
  }
}

/**
 * Calls the API for server-confirmed access to the travel packing checklist.
 * Maps 401/403 to a permission-denied result (never treated as empty).
 */
export async function checkPermission(petId: string): Promise<PermissionResult> {
  try {
    const response = await apiClient.get(
      `/pets/${encodeURIComponent(petId)}/travel-packing-checklist/permission`,
    );
    if (response?.status === 401) {
      return { granted: false, reason: 'unauthenticated' };
    }
    if (response?.status === 403) {
      return { granted: false, reason: 'denied' };
    }
    if (response?.status >= 200 && response?.status < 300) {
      const granted = response?.data?.granted === true;
      return granted ? { granted: true } : { granted: false, reason: 'denied' };
    }
    return { granted: false, reason: 'error' };
  } catch (error: unknown) {
    const status =
      (error as { response?: { status?: number } })?.response?.status ?? 0;
    if (status === 401) return { granted: false, reason: 'unauthenticated' };
    if (status === 403) return { granted: false, reason: 'denied' };
    return { granted: false, reason: 'error' };
  }
}

/**
 * Flushes queued checklist mutations with retry. Prefers the newer of local
 * vs server payload by comparing updatedAt. Never logs item labels or notes.
 */
export async function syncPending(): Promise<{
  synced: number;
  failed: number;
}> {
  let synced = 0;
  let failed = 0;

  let pending: Awaited<ReturnType<typeof offlineQueue.getPending>> = [];
  try {
    pending = await offlineQueue.getPending(SYNC_ENTITY);
  } catch {
    return { synced: 0, failed: 0 };
  }

  for (const mutation of pending) {
    const payload = mutation.payload as
      | {
          petId?: string;
          tripId?: string;
          updatedAt?: number;
          items?: PackingItem[];
        }
      | undefined;

    const petId = payload?.petId;
    const tripId = payload?.tripId;
    if (!petId || !tripId) {
      failed += 1;
      continue;
    }

    try {
      await withRetry(async () => {
        const local = await loadChecklist(petId, tripId);
        const serverResponse = await apiClient.get(
          `/pets/${encodeURIComponent(petId)}/travel-packing-checklists/${encodeURIComponent(tripId)}`,
        );
        const serverChecklist = normalizeChecklist(serverResponse?.data);

        const localUpdatedAt = local?.updatedAt ?? 0;
        const serverUpdatedAt = serverChecklist?.updatedAt ?? 0;

        if (serverChecklist && serverUpdatedAt > localUpdatedAt) {
          // Server is newer: adopt it locally.
          await writeLocal(serverChecklist);
          return;
        }

        const toPush: TravelPackingChecklist = local ?? {
          petId,
          tripId,
          items: payload?.items ?? [],
          updatedAt: payload?.updatedAt ?? Date.now(),
        };

        await apiClient.put(
          `/pets/${encodeURIComponent(petId)}/travel-packing-checklists/${encodeURIComponent(tripId)}`,
          {
            updatedAt: toPush.updatedAt,
            items: toPush.items,
          },
        );
      });

      try {
        await offlineQueue.remove(mutation.id);
      } catch {
        // Ignore removal errors; mutation may retry next flush.
      }
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { synced, failed };
}

export const travelPackingChecklistService = {
  loadChecklist,
  saveChecklist,
  checkPermission,
  syncPending,
};