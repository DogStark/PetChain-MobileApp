/**
 * Offline-first server reads shared by issues #1149, #1152, #1153 and #1159.
 *
 * - The server is the source of truth for data and permissions. A 401/403
 *   is reported as `denied` and the local copy is cleared, so access the
 *   server revoked is never served from cache.
 * - While offline, or when the request fails, the last good copy is returned
 *   together with the time it was refreshed so the UI can flag stale data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { networkMonitor } from '../utils/networkMonitor';
import { withRetry } from '../utils/retry';

export type ServerReadStatus = 'fresh' | 'offline' | 'denied' | 'error';

export interface ServerReadResult<T> {
  status: ServerReadStatus;
  data: T | null;
  /** Epoch ms of the last successful server refresh, if any. */
  lastRefreshedAt: number | null;
  /** True when the data is older than the allowed age. */
  isStale: boolean;
}

interface CacheEntry<T> {
  data: T;
  savedAt: number;
}

export const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function getHttpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

export function isPermissionDenied(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 401 || status === 403;
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    return parsed && typeof parsed.savedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T, savedAt = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ data, savedAt }));
  } catch {
    // Cache writes are best effort.
  }
}

export async function clearCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

export interface ServerReadOptions<T> {
  cacheKey: string;
  fetch: () => Promise<unknown>;
  normalize: (raw: unknown) => T | null;
  staleAfterMs?: number;
  now?: number;
  retryDelayMs?: number;
}

export async function readThroughCache<T>(
  opts: ServerReadOptions<T>,
): Promise<ServerReadResult<T>> {
  const now = opts.now ?? Date.now();
  const staleAfter = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  const fromCache = async (status: ServerReadStatus): Promise<ServerReadResult<T>> => {
    const cached = await readCache<T>(opts.cacheKey);
    return {
      status,
      data: cached?.data ?? null,
      lastRefreshedAt: cached?.savedAt ?? null,
      isStale: cached ? now - cached.savedAt > staleAfter : false,
    };
  };

  if (!(await networkMonitor.isOnline())) return fromCache('offline');

  try {
    const raw = await withRetry(opts.fetch, {
      maxRetries: 2,
      initialDelay: opts.retryDelayMs ?? 500,
    });
    const data = opts.normalize(raw);
    if (data === null) return fromCache('error');
    await writeCache(opts.cacheKey, data, now);
    return { status: 'fresh', data, lastRefreshedAt: now, isStale: false };
  } catch (error) {
    if (isPermissionDenied(error)) {
      await clearCache(opts.cacheKey);
      return { status: 'denied', data: null, lastRefreshedAt: null, isStale: false };
    }
    return fromCache('error');
  }
}

/** Short, screen-reader friendly description of when data was last refreshed. */
export function formatLastRefreshed(lastRefreshedAt: number | null, now = Date.now()): string {
  if (lastRefreshedAt === null) return 'Never refreshed';
  const minutes = Math.max(0, Math.floor((now - lastRefreshedAt) / 60000));
  if (minutes < 1) return 'Last refreshed just now';
  if (minutes < 60) return `Last refreshed ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last refreshed ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Last refreshed ${days} day${days === 1 ? '' : 's'} ago`;
}
