import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  preventScreenCaptureAsync,
  allowScreenCaptureAsync,
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from 'expo-screen-capture';

const CAPTURE_KEY = 'appLock';
const TIMEOUT_STORAGE_KEY = '@appLock_timeout';
const BACKGROUND_TIMESTAMP_KEY = '@appLock_background_timestamp';
const FOREGROUND_TIMESTAMP_KEY = '@appLock_foreground_timestamp';

/** Lock timeout options in milliseconds. 0 = never auto-lock. */
export const LOCK_TIMEOUTS = {
  '1min': 60_000,
  '5min': 300_000,
  '15min': 900_000,
  never: 0,
} as const;

export type LockTimeout = keyof typeof LOCK_TIMEOUTS;

/** Screens that are whitelisted for screenshots (non-sensitive). */
const WHITELISTED_SCREENS = new Set<string>(['OnboardingScreen', 'CommunityScreen']);

let _screenshotPrevented = false;

/** Enable screen capture prevention globally. */
export async function enableScreenCapturePrevention(): Promise<void> {
  if (_screenshotPrevented) return;
  await preventScreenCaptureAsync(CAPTURE_KEY);
  await enableAppSwitcherProtectionAsync(0.8);
  _screenshotPrevented = true;
}

/** Disable screen capture prevention globally. */
export async function disableScreenCapturePrevention(): Promise<void> {
  if (!_screenshotPrevented) return;
  await allowScreenCaptureAsync(CAPTURE_KEY);
  await disableAppSwitcherProtectionAsync();
  _screenshotPrevented = false;
}

/** Allow screenshots for a specific whitelisted screen. */
export async function allowScreenForRoute(routeName: string): Promise<void> {
  if (WHITELISTED_SCREENS.has(routeName)) {
    await allowScreenCaptureAsync(CAPTURE_KEY);
  } else {
    await preventScreenCaptureAsync(CAPTURE_KEY);
  }
}

/** Persist the user's chosen lock timeout. */
export async function saveLockTimeout(timeout: LockTimeout): Promise<void> {
  await AsyncStorage.setItem(TIMEOUT_STORAGE_KEY, timeout);
}

/** Load the user's chosen lock timeout (defaults to '5min'). */
export async function loadLockTimeout(): Promise<LockTimeout> {
  const stored = await AsyncStorage.getItem(TIMEOUT_STORAGE_KEY);
  if (stored && stored in LOCK_TIMEOUTS) return stored as LockTimeout;
  return '5min';
}

/** Returns the timeout duration in ms for the given key. */
export function getLockTimeoutMs(timeout: LockTimeout): number {
  return LOCK_TIMEOUTS[timeout];
}

/**
 * Calculate elapsed time using a monotonic clock source (performance.now()).
 * Falls back to Date.now() if performance API is unavailable.
 * @param startTime - Reference time from performance.now() or Date.now()
 * @returns Elapsed milliseconds since startTime
 */
export function getMonotonicElapsed(startTime: number): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() - startTime;
  }
  // Fallback to wall-clock time (less ideal but better than nothing)
  return Date.now() - startTime;
}

/**
 * Persist the current timestamp when the app enters background state.
 * This timestamp serves as the baseline for calculating lock-timeout elapsed time
 * and survives app process death.
 */
export async function persistAppBackground(): Promise<void> {
  try {
    const timestamp = Date.now();
    await AsyncStorage.setItem(BACKGROUND_TIMESTAMP_KEY, String(timestamp));
  } catch {
    // Fail gracefully; the timeout will be evaluated on next foreground
  }
}

/**
 * Persist the current timestamp when the app enters foreground state.
 * Used alongside the background timestamp to cross-check for clock anomalies.
 */
export async function persistAppForeground(): Promise<void> {
  try {
    const timestamp = Date.now();
    await AsyncStorage.setItem(FOREGROUND_TIMESTAMP_KEY, String(timestamp));
  } catch {
    // Fail gracefully
  }
}

/**
 * Retrieve the elapsed time since the app last backgrounded.
 * Detects and safely handles clock rollback by returning 0 if the persisted
 * background timestamp is in the future relative to the current time.
 * @returns Elapsed milliseconds since app backgrounded, or 0 if not available or clock was rolled back
 */
export async function getElapsedSinceBackground(): Promise<number> {
  try {
    const backgroundTimestampStr = await AsyncStorage.getItem(BACKGROUND_TIMESTAMP_KEY);
    if (!backgroundTimestampStr) {
      return 0;
    }

    const backgroundTimestamp = parseInt(backgroundTimestampStr, 10);
    if (isNaN(backgroundTimestamp)) {
      return 0;
    }

    const now = Date.now();
    // Detect clock rollback: if background timestamp is in the future, return 0
    if (backgroundTimestamp > now) {
      return 0;
    }

    return now - backgroundTimestamp;
  } catch {
    return 0;
  }
}

/**
 * Clear persisted app lifecycle timestamps.
 * Called after successful unlock to reset the baseline for the next background/foreground cycle.
 */
export async function clearPersistedTimestamps(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(BACKGROUND_TIMESTAMP_KEY),
      AsyncStorage.removeItem(FOREGROUND_TIMESTAMP_KEY),
    ]);
  } catch {
    // Fail gracefully
  }
}
