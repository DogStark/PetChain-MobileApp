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

// ─── Privacy-Preserving App Lock Setting (Issue #1188) ───────────────────────

const PRIVACY_APP_LOCK_CONFIG_KEY = '@appLock_privacy_config_v1';

export type RelockTimingOption = 'immediate' | LockTimeout;

export const RELOCK_TIMING_MS: Record<RelockTimingOption, number> = {
  immediate: 0,
  '1min': LOCK_TIMEOUTS['1min'],
  '5min': LOCK_TIMEOUTS['5min'],
  '15min': LOCK_TIMEOUTS['15min'],
  never: -1,
};

export interface PrivacyAppLockConfig {
  enabled: boolean;
  relockTiming: RelockTimingOption;
  coverInAppSwitcher: boolean;
  redactPetPreviewDetails: boolean;
  reduceMotionCover: boolean;
  policyVersion: number;
  updatedAt: number;
}

export const DEFAULT_PRIVACY_APP_LOCK_CONFIG: PrivacyAppLockConfig = {
  enabled: true,
  relockTiming: '1min',
  coverInAppSwitcher: true,
  redactPetPreviewDetails: true,
  reduceMotionCover: false,
  policyVersion: 1,
  updatedAt: 0,
};

export interface AppLockRecoveryDescriptor {
  action: 'retry_biometric' | 'use_passcode_fallback' | 'reauthenticate_session' | 'refresh_policy';
  reason:
    | 'biometric_failed'
    | 'biometric_unavailable'
    | 'max_attempts_exceeded'
    | 'permission_denied'
    | 'stale_policy';
  message: string;
  accessibilityAnnouncement: string;
  keepSensitiveContentCovered: true;
}

export interface ServerAppLockPolicyResponse {
  ok: boolean;
  status: number;
  confirmed?: boolean;
  permissionDenied?: boolean;
  stalePolicy?: boolean;
  serverPolicyVersion?: number;
  enforcedConfig?: Partial<PrivacyAppLockConfig>;
}

export interface UpdatePrivacyAppLockResult {
  status: 'confirmed' | 'pending_offline' | 'denied' | 'stale';
  config: PrivacyAppLockConfig;
  serverConfirmed: boolean;
  recovery?: AppLockRecoveryDescriptor;
  accessibilityAnnouncement: string;
}

function isValidRelockTiming(value: unknown): value is RelockTimingOption {
  return typeof value === 'string' && value in RELOCK_TIMING_MS;
}

function normalizePrivacyAppLockConfig(
  raw: Partial<PrivacyAppLockConfig> | null | undefined,
): PrivacyAppLockConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PRIVACY_APP_LOCK_CONFIG };
  }
  return {
    enabled:
      typeof raw.enabled === 'boolean'
        ? raw.enabled
        : DEFAULT_PRIVACY_APP_LOCK_CONFIG.enabled,
    relockTiming: isValidRelockTiming(raw.relockTiming)
      ? raw.relockTiming
      : DEFAULT_PRIVACY_APP_LOCK_CONFIG.relockTiming,
    coverInAppSwitcher:
      typeof raw.coverInAppSwitcher === 'boolean'
        ? raw.coverInAppSwitcher
        : DEFAULT_PRIVACY_APP_LOCK_CONFIG.coverInAppSwitcher,
    redactPetPreviewDetails:
      typeof raw.redactPetPreviewDetails === 'boolean'
        ? raw.redactPetPreviewDetails
        : DEFAULT_PRIVACY_APP_LOCK_CONFIG.redactPetPreviewDetails,
    reduceMotionCover:
      typeof raw.reduceMotionCover === 'boolean'
        ? raw.reduceMotionCover
        : DEFAULT_PRIVACY_APP_LOCK_CONFIG.reduceMotionCover,
    policyVersion:
      typeof raw.policyVersion === 'number' && Number.isInteger(raw.policyVersion)
        ? raw.policyVersion
        : DEFAULT_PRIVACY_APP_LOCK_CONFIG.policyVersion,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : DEFAULT_PRIVACY_APP_LOCK_CONFIG.updatedAt,
  };
}

/**
 * Loads the persisted privacy-preserving app lock configuration, falling back
 * to privacy-preserving defaults when unset or corrupted.
 */
export async function loadPrivacyAppLockConfig(): Promise<PrivacyAppLockConfig> {
  try {
    const raw = await AsyncStorage.getItem(PRIVACY_APP_LOCK_CONFIG_KEY);
    if (!raw) {
      return { ...DEFAULT_PRIVACY_APP_LOCK_CONFIG };
    }
    const parsed = JSON.parse(raw) as Partial<PrivacyAppLockConfig>;
    return normalizePrivacyAppLockConfig(parsed);
  } catch {
    return { ...DEFAULT_PRIVACY_APP_LOCK_CONFIG };
  }
}

/**
 * Applies app-switcher preview cover and screenshot protection for the given
 * route and accessibility preferences. Sensitive pet screens remain covered by
 * default.
 */
export async function applyAppSwitcherPrivacyCover(
  routeName: string,
  config: PrivacyAppLockConfig = DEFAULT_PRIVACY_APP_LOCK_CONFIG,
  accessibility?: { reduceMotionEnabled?: boolean },
): Promise<{
  covered: boolean;
  blurIntensity: number;
  screenCapturePrevented: boolean;
  accessibilityLabel: string;
}> {
  const isWhitelisted = WHITELISTED_SCREENS.has(routeName);
  const shouldCover = config.coverInAppSwitcher || (!isWhitelisted && config.enabled);
  const useSolidCover =
    Boolean(accessibility?.reduceMotionEnabled) || config.reduceMotionCover;
  const blurIntensity = useSolidCover ? 1.0 : 0.85;

  if (shouldCover && !isWhitelisted) {
    await preventScreenCaptureAsync(CAPTURE_KEY);
    await enableAppSwitcherProtectionAsync(blurIntensity);
    _screenshotPrevented = true;
    return {
      covered: true,
      blurIntensity,
      screenCapturePrevented: true,
      accessibilityLabel:
        'Privacy cover active in app switcher. Sensitive pet information is hidden.',
    };
  }

  await allowScreenCaptureAsync(CAPTURE_KEY);
  await disableAppSwitcherProtectionAsync();
  _screenshotPrevented = false;
  return {
    covered: false,
    blurIntensity: 0,
    screenCapturePrevented: false,
    accessibilityLabel: 'App switcher preview visible for public screen.',
  };
}

/**
 * Evaluates whether the app must relock upon returning to the foreground.
 * Treats clock rollback conservatively as requiring a relock when app lock is
 * enabled so clock tampering cannot bypass the lock.
 */
export async function evaluateRelockRequirement(
  config: PrivacyAppLockConfig,
  nowMs: number = Date.now(),
): Promise<{
  shouldLock: boolean;
  reason: 'disabled' | 'never_timeout' | 'immediate' | 'timeout_elapsed' | 'within_grace_period' | 'clock_rollback';
  elapsedMs: number;
}> {
  if (!config.enabled) {
    return { shouldLock: false, reason: 'disabled', elapsedMs: 0 };
  }

  const thresholdMs = RELOCK_TIMING_MS[config.relockTiming];
  if (thresholdMs < 0) {
    return { shouldLock: false, reason: 'never_timeout', elapsedMs: 0 };
  }

  if (thresholdMs === 0) {
    return { shouldLock: true, reason: 'immediate', elapsedMs: 0 };
  }

  try {
    const storedBg = await AsyncStorage.getItem(BACKGROUND_TIMESTAMP_KEY);
    if (!storedBg) {
      return { shouldLock: false, reason: 'within_grace_period', elapsedMs: 0 };
    }
    const bgTimestamp = parseInt(storedBg, 10);
    if (Number.isNaN(bgTimestamp)) {
      return { shouldLock: true, reason: 'clock_rollback', elapsedMs: 0 };
    }
    if (bgTimestamp > nowMs) {
      return { shouldLock: true, reason: 'clock_rollback', elapsedMs: 0 };
    }
    const elapsedMs = nowMs - bgTimestamp;
    if (elapsedMs >= thresholdMs) {
      return { shouldLock: true, reason: 'timeout_elapsed', elapsedMs };
    }
    return { shouldLock: false, reason: 'within_grace_period', elapsedMs };
  } catch {
    return { shouldLock: true, reason: 'timeout_elapsed', elapsedMs: 0 };
  }
}

/**
 * Updates the privacy-preserving app lock setting with server-confirmed
 * permissions, offline preservation, bounded retry, and explicit recovery
 * behavior on denial or stale policy state.
 */
export async function updatePrivacyAppLockSetting(
  patch: Partial<PrivacyAppLockConfig>,
  options?: {
    nowMs?: number;
    isOnline?: boolean;
    maxRetries?: number;
    confirmOnServer?: (
      candidate: PrivacyAppLockConfig,
    ) => Promise<ServerAppLockPolicyResponse>;
  },
): Promise<UpdatePrivacyAppLockResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const previous = await loadPrivacyAppLockConfig();
  const candidate = normalizePrivacyAppLockConfig({
    ...previous,
    ...patch,
    updatedAt: nowMs,
  });

  await AsyncStorage.setItem(PRIVACY_APP_LOCK_CONFIG_KEY, JSON.stringify(candidate));
  if (candidate.relockTiming !== 'immediate') {
    await saveLockTimeout(candidate.relockTiming);
  }

  if (options?.isOnline === false || !options?.confirmOnServer) {
    return {
      status: 'pending_offline',
      config: candidate,
      serverConfirmed: false,
      accessibilityAnnouncement:
        'App lock privacy settings saved locally and will sync when online.',
    };
  }

  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await options.confirmOnServer(candidate);

      if (response.permissionDenied || response.status === 401 || response.status === 403) {
        const safeFallback = normalizePrivacyAppLockConfig({
          ...previous,
          ...response.enforcedConfig,
          coverInAppSwitcher: true,
          redactPetPreviewDetails: true,
        });
        await AsyncStorage.setItem(
          PRIVACY_APP_LOCK_CONFIG_KEY,
          JSON.stringify(safeFallback),
        );
        const recovery: AppLockRecoveryDescriptor = {
          action: 'reauthenticate_session',
          reason: 'permission_denied',
          message:
            'Your account does not have permission to relax app lock privacy settings.',
          accessibilityAnnouncement:
            'Permission denied to change app lock settings. Sensitive pet data remains protected.',
          keepSensitiveContentCovered: true,
        };
        return {
          status: 'denied',
          config: safeFallback,
          serverConfirmed: false,
          recovery,
          accessibilityAnnouncement: recovery.accessibilityAnnouncement,
        };
      }

      if (response.stalePolicy || response.status === 409) {
        const syncedConfig = normalizePrivacyAppLockConfig({
          ...candidate,
          ...response.enforcedConfig,
          policyVersion:
            response.serverPolicyVersion ?? candidate.policyVersion + 1,
          coverInAppSwitcher: true,
          redactPetPreviewDetails: true,
        });
        await AsyncStorage.setItem(
          PRIVACY_APP_LOCK_CONFIG_KEY,
          JSON.stringify(syncedConfig),
        );
        const recovery: AppLockRecoveryDescriptor = {
          action: 'refresh_policy',
          reason: 'stale_policy',
          message:
            'App lock policy was updated on another device. Reloaded latest security policy.',
          accessibilityAnnouncement:
            'Security policy updated from server. Sensitive screens remain covered.',
          keepSensitiveContentCovered: true,
        };
        return {
          status: 'stale',
          config: syncedConfig,
          serverConfirmed: false,
          recovery,
          accessibilityAnnouncement: recovery.accessibilityAnnouncement,
        };
      }

      if (response.ok && response.confirmed !== false) {
        const confirmedConfig: PrivacyAppLockConfig = {
          ...candidate,
          policyVersion:
            response.serverPolicyVersion ?? candidate.policyVersion,
        };
        await AsyncStorage.setItem(
          PRIVACY_APP_LOCK_CONFIG_KEY,
          JSON.stringify(confirmedConfig),
        );
        return {
          status: 'confirmed',
          config: confirmedConfig,
          serverConfirmed: true,
          accessibilityAnnouncement: 'App lock privacy settings confirmed and active.',
        };
      }

      if (attempt < maxRetries) {
        attempt += 1;
        continue;
      }

      return {
        status: 'pending_offline',
        config: candidate,
        serverConfirmed: false,
        accessibilityAnnouncement:
          'App lock privacy settings saved locally and will sync when server is reachable.',
      };
    } catch {
      if (attempt < maxRetries) {
        attempt += 1;
        continue;
      }
      return {
        status: 'pending_offline',
        config: candidate,
        serverConfirmed: false,
        accessibilityAnnouncement:
          'App lock privacy settings saved locally and will sync when online.',
      };
    }
  }

  return {
    status: 'pending_offline',
    config: candidate,
    serverConfirmed: false,
    accessibilityAnnouncement:
      'App lock privacy settings saved locally and will sync when online.',
  };
}

/**
 * Determines explicit recovery behavior when unlocking fails or biometric
 * hardware is unavailable, keeping sensitive pet data covered until recovery
 * completes.
 */
export function resolveAppLockRecovery(params: {
  failedAttempts: number;
  maxAttempts?: number;
  biometricAvailable: boolean;
  passcodeConfigured: boolean;
}): AppLockRecoveryDescriptor {
  const maxAttempts = params.maxAttempts ?? 3;

  if (params.failedAttempts >= maxAttempts) {
    if (params.passcodeConfigured) {
      return {
        action: 'use_passcode_fallback',
        reason: 'max_attempts_exceeded',
        message: 'Too many biometric attempts. Enter your app passcode to unlock.',
        accessibilityAnnouncement:
          'Maximum biometric attempts reached. Please enter your passcode to unlock.',
        keepSensitiveContentCovered: true,
      };
    }
    return {
      action: 'reauthenticate_session',
      reason: 'max_attempts_exceeded',
      message: 'Too many failed unlock attempts. Please sign in again to verify your identity.',
      accessibilityAnnouncement:
        'Maximum unlock attempts reached. Sign in required to access pet records.',
      keepSensitiveContentCovered: true,
    };
  }

  if (!params.biometricAvailable) {
    if (params.passcodeConfigured) {
      return {
        action: 'use_passcode_fallback',
        reason: 'biometric_unavailable',
        message: 'Biometrics unavailable. Unlock with your app passcode.',
        accessibilityAnnouncement:
          'Biometric authentication unavailable. Use your passcode to unlock.',
        keepSensitiveContentCovered: true,
      };
    }
    return {
      action: 'reauthenticate_session',
      reason: 'biometric_unavailable',
      message: 'Biometrics unavailable. Please sign in again to continue.',
      accessibilityAnnouncement:
        'Biometric authentication unavailable. Please sign in to continue.',
      keepSensitiveContentCovered: true,
    };
  }

  return {
    action: 'retry_biometric',
    reason: 'biometric_failed',
    message: 'Unlock failed. Try biometric authentication again or use passcode.',
    accessibilityAnnouncement:
      'Unlock was not recognized. Try again or choose passcode fallback.',
    keepSensitiveContentCovered: true,
  };
}

