/**
 * Version Check Service
 *
 * Fetches the minimum/recommended app version from the backend and compares
 * it against the currently installed version to determine if an update is needed.
 * Results are cached for 1 hour to avoid repeated API calls on every launch.
 */

import * as Application from 'expo-application';
import { Platform } from 'react-native';

import apiClient from './apiClient';
import { logError } from '../utils/errorLogger';

export type VersionCheckResult =
  | { type: 'up-to-date' }
  | { type: 'critical'; storeUrl: string; message: string }
  | { type: 'recommended'; storeUrl: string; message: string }
  | { type: 'error'; message: string };

interface VersionCheckResponse {
  minimumVersion: string;
  recommendedVersion: string;
  iosStoreUrl: string;
  androidStoreUrl: string;
  message: string;
}

const CACHE_KEY = '@version_check_cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedResult {
  result: VersionCheckResult;
  cachedAt: number;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

async function readCache(): Promise<VersionCheckResult | null> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedResult = JSON.parse(raw);
    if (Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.result;
    await AsyncStorage.removeItem(CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

async function writeCache(result: VersionCheckResult): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const cached: CachedResult = { result, cachedAt: Date.now() };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // non-critical
  }
}

/**
 * Check whether the current app version meets the server's minimum/recommended version.
 * Returns a cached result if available and fresh (< 1 hour old).
 */
export async function checkAppVersion(): Promise<VersionCheckResult> {
  const cached = await readCache();
  if (cached) return cached;

  try {
    const { data } = await apiClient.get<VersionCheckResponse>('/app/version-check');

    const currentVersion = Application.nativeApplicationVersion ?? '1.0.0';
    const storeUrl = Platform.OS === 'ios' ? data.iosStoreUrl : data.androidStoreUrl;

    let result: VersionCheckResult;

    if (compareVersions(currentVersion, data.minimumVersion) < 0) {
      result = { type: 'critical', storeUrl, message: data.message };
    } else if (compareVersions(currentVersion, data.recommendedVersion) < 0) {
      result = { type: 'recommended', storeUrl, message: data.message };
    } else {
      result = { type: 'up-to-date' };
    }

    await writeCache(result);
    return result;
  } catch (err) {
    logError(err as Error, { context: 'checkAppVersion' });
    return { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Clear the cached version check result (e.g. to force a fresh check). */
export async function clearVersionCheckCache(): Promise<void> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // non-critical
  }
}
