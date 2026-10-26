/**
 * Offline navigation notes for saved clinics — Issue #1152
 *
 * Users can save a clinic's contact and address details for offline viewing.
 * Each saved clinic keeps the time of its last successful server refresh so
 * the UI can show it and flag stale details. Only clinic details are stored;
 * no pet data is written to the cache.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import api from './api';
import {
  clearCache,
  formatLastRefreshed,
  readCache,
  readThroughCache,
  type ServerReadResult,
} from './offlineServerCache';

export interface SavedClinic {
  id: string;
  name: string;
  phone?: string;
  address: string;
  latitude?: number;
  longitude?: number;
  /** Free-text directions written by the user, e.g. "parking at rear". */
  navigationNote?: string;
}

export interface SavedClinicEntry {
  clinic: SavedClinic;
  lastRefreshedAt: number | null;
  isStale: boolean;
  lastRefreshedLabel: string;
}

const INDEX_KEY = 'savedClinics:index';
const NOTE_MAX_LENGTH = 500;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const clinicKey = (id: string) => `savedClinic:${id}`;
const noteKey = (id: string) => `savedClinicNote:${id}`;

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(Array.from(new Set(ids))));
}

function normalizeClinic(raw: unknown): SavedClinic | null {
  const v = raw as Record<string, unknown> | null;
  if (!v || typeof v.id !== 'string' || typeof v.name !== 'string') return null;
  if (typeof v.address !== 'string' || !v.address.trim()) return null;
  return {
    id: v.id,
    name: v.name,
    address: v.address,
    phone: typeof v.phone === 'string' ? v.phone : undefined,
    latitude: typeof v.latitude === 'number' ? v.latitude : undefined,
    longitude: typeof v.longitude === 'number' ? v.longitude : undefined,
  };
}

/** Fetches the clinic from the server and refreshes its offline copy. */
export async function refreshSavedClinic(
  clinicId: string,
  opts: { now?: number; retryDelayMs?: number } = {},
): Promise<ServerReadResult<SavedClinic>> {
  const result = await readThroughCache({
    cacheKey: clinicKey(clinicId),
    fetch: async () => (await api.get(`/clinics/${encodeURIComponent(clinicId)}`)).data,
    normalize: normalizeClinic,
    staleAfterMs: STALE_AFTER_MS,
    ...opts,
  });
  if (result.status === 'denied') {
    await removeSavedClinic(clinicId);
  }
  return result;
}

/** Saves a clinic for offline viewing. Requires a successful server fetch. */
export async function saveClinicForOffline(
  clinicId: string,
  opts: { now?: number; retryDelayMs?: number } = {},
): Promise<ServerReadResult<SavedClinic>> {
  const result = await refreshSavedClinic(clinicId, opts);
  if (result.status === 'fresh') {
    await writeIndex([...(await readIndex()), clinicId]);
  }
  return result;
}

export async function removeSavedClinic(clinicId: string): Promise<void> {
  await writeIndex((await readIndex()).filter((id) => id !== clinicId));
  await clearCache(clinicKey(clinicId));
  await clearCache(noteKey(clinicId));
}

export async function setNavigationNote(clinicId: string, note: string): Promise<void> {
  const trimmed = note.trim().slice(0, NOTE_MAX_LENGTH);
  if (!trimmed) {
    await clearCache(noteKey(clinicId));
    return;
  }
  await AsyncStorage.setItem(noteKey(clinicId), trimmed);
}

/** Lists saved clinics from local storage only; works fully offline. */
export async function getSavedClinics(now = Date.now()): Promise<SavedClinicEntry[]> {
  const entries: SavedClinicEntry[] = [];
  for (const id of await readIndex()) {
    const cached = await readCache<SavedClinic>(clinicKey(id));
    if (!cached) continue;
    const note = await AsyncStorage.getItem(noteKey(id)).catch(() => null);
    entries.push({
      clinic: { ...cached.data, navigationNote: note ?? undefined },
      lastRefreshedAt: cached.savedAt,
      isStale: now - cached.savedAt > STALE_AFTER_MS,
      lastRefreshedLabel: formatLastRefreshed(cached.savedAt, now),
    });
  }
  return entries.sort((a, b) => a.clinic.name.localeCompare(b.clinic.name));
}
