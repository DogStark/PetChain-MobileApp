import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_ENDPOINTS } from '../config/apiEndpoints';
import { FEATURE_FLAGS, type FeatureFlag } from '../config/constants';
import { storageKeys } from '../config/storageKeys';
import apiClient from './apiClient';

/**
 * What a user may see for a feature. Internal rollout flags and their names
 * never leave this module: the UI only ever receives one of these three states.
 */
export type FeatureAvailabilityState = 'enabled' | 'unavailable' | 'maintenance';

/** Status the server confirms for this account. `disabled` means not permitted or not yet rolled out. */
export type ServerFeatureStatus = 'enabled' | 'disabled' | 'maintenance';

export interface FeatureAvailabilitySnapshot {
  features: Partial<Record<FeatureFlag, ServerFeatureStatus>>;
  /** Epoch ms when the server last confirmed these statuses. */
  fetchedAt: number;
}

const FEATURE_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlag[];
const SERVER_STATUSES: readonly string[] = ['enabled', 'disabled', 'maintenance'];

/**
 * Resolves the state shown for a feature.
 *
 * - The build-level flag is a hard ceiling: a feature switched off for this
 *   build is never shown, whatever the server says.
 * - Server-confirmed `maintenance` and `disabled` override the local default.
 * - With no server confirmation (first launch offline, or never fetched) the
 *   local default applies, so behaviour matches the app before this gate existed.
 */
export function resolveFeatureAvailability(
  feature: FeatureFlag,
  snapshot: FeatureAvailabilitySnapshot | null,
): FeatureAvailabilityState {
  if (!FEATURE_FLAGS[feature]) {
    return 'unavailable';
  }
  const status = snapshot?.features[feature];
  if (status === 'maintenance') {
    return 'maintenance';
  }
  if (status === 'disabled') {
    return 'unavailable';
  }
  return 'enabled';
}

/**
 * Validates untrusted server or cached JSON. Unknown feature keys are dropped
 * and unknown statuses are ignored, so they fall back to the local default.
 */
function toSnapshot(rawFeatures: unknown, fetchedAt: number): FeatureAvailabilitySnapshot | null {
  if (!rawFeatures || typeof rawFeatures !== 'object' || Array.isArray(rawFeatures)) {
    return null;
  }
  const source = rawFeatures as Record<string, unknown>;
  const features: FeatureAvailabilitySnapshot['features'] = {};
  for (const key of FEATURE_KEYS) {
    const status = source[key];
    if (typeof status === 'string' && SERVER_STATUSES.includes(status)) {
      features[key] = status as ServerFeatureStatus;
    }
  }
  return { features, fetchedAt };
}

/** Reads the last confirmed snapshot. Used when offline or when the server call fails. */
export async function loadCachedFeatureAvailability(): Promise<FeatureAvailabilitySnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKeys.cache.featureAvailability);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { features?: unknown; fetchedAt?: unknown };
    return toSnapshot(parsed.features, typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0);
  } catch {
    return null;
  }
}

/**
 * Fetches server-confirmed availability and caches it. On any failure, falls
 * back to the cached snapshot so existing offline behaviour is preserved.
 * Never throws.
 */
export async function fetchFeatureAvailability(): Promise<FeatureAvailabilitySnapshot | null> {
  try {
    const response = await apiClient.get<{ data: { features?: unknown } }>(
      API_ENDPOINTS.features.availability,
    );
    const snapshot = toSnapshot(response.data?.data?.features, Date.now());
    if (!snapshot) {
      return loadCachedFeatureAvailability();
    }
    await AsyncStorage.setItem(
      storageKeys.cache.featureAvailability,
      JSON.stringify(snapshot),
    ).catch(() => {});
    return snapshot;
  } catch {
    return loadCachedFeatureAvailability();
  }
}
