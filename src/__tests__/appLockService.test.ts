/**
 * Tests for src/services/appLockService.ts
 *
 * Verifies: monotonic timeout calculation, clock rollback handling,
 * process death/reboot safety, and persisted lifecycle timestamps.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenCapture from 'expo-screen-capture';
import {
  DEFAULT_PRIVACY_APP_LOCK_CONFIG,
  applyAppSwitcherPrivacyCover,
  clearPersistedTimestamps,
  evaluateRelockRequirement,
  getElapsedSinceBackground,
  getMonotonicElapsed,
  loadPrivacyAppLockConfig,
  persistAppBackground,
  persistAppForeground,
  resolveAppLockRecovery,
  updatePrivacyAppLockSetting,
} from '../services/appLockService';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => {
    const mock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    };
    return {
      __esModule: true,
      default: mock,
      ...mock,
    };
  },
  { virtual: true },
);
jest.mock(
  'expo-screen-capture',
  () => ({
    preventScreenCaptureAsync: jest.fn().mockResolvedValue(undefined),
    allowScreenCaptureAsync: jest.fn().mockResolvedValue(undefined),
    enableAppSwitcherProtectionAsync: jest.fn().mockResolvedValue(undefined),
    disableAppSwitcherProtectionAsync: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockScreenCapture = ScreenCapture as jest.Mocked<typeof ScreenCapture>;


beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('appLockService - Monotonic timeout and reboot safety', () => {
  describe('getMonotonicElapsed', () => {
    it('returns elapsed time using performance.now() when available', () => {
      const before = performance.now();
      jest.advanceTimersByTime(1000);
      const elapsed = getMonotonicElapsed(before);
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });

    it('falls back to Date.now() when performance.now() is unavailable', () => {
      const savedPerformance = global.performance;
      // @ts-ignore
      global.performance = undefined;

      const beforeMs = Date.now();
      jest.advanceTimersByTime(1000);
      const elapsed = getMonotonicElapsed(beforeMs);
      expect(elapsed).toBeGreaterThanOrEqual(1000);

      global.performance = savedPerformance;
    });
  });

  describe('persistAppBackground', () => {
    it('stores the current timestamp to AsyncStorage', async () => {
      mockAsyncStorage.setItem.mockResolvedValue(null);
      jest.setSystemTime(new Date('2025-01-01T12:00:00Z'));

      await persistAppBackground();

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('background'),
        expect.any(String),
      );
    });

    it('handles AsyncStorage write failure gracefully', async () => {
      mockAsyncStorage.setItem.mockRejectedValue(new Error('Storage error'));
      await expect(persistAppBackground()).resolves.not.toThrow();
    });
  });

  describe('persistAppForeground', () => {
    it('stores the current timestamp to AsyncStorage', async () => {
      mockAsyncStorage.setItem.mockResolvedValue(null);

      await persistAppForeground();

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('foreground'),
        expect.any(String),
      );
    });
  });

  describe('getElapsedSinceBackground', () => {
    it('returns elapsed time from persisted background timestamp', async () => {
      const backgroundTime = Date.now();
      mockAsyncStorage.getItem.mockResolvedValue(String(backgroundTime));

      jest.advanceTimersByTime(5000);

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBeGreaterThanOrEqual(5000);
    });

    it('returns 0 when no background timestamp is persisted (e.g., first launch)', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });

    it('handles clock rollback: returns 0 if background timestamp is in future', async () => {
      const futureTime = Date.now() + 10000;
      mockAsyncStorage.getItem.mockResolvedValue(String(futureTime));

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });

    it('handles malformed persisted timestamp gracefully', async () => {
      mockAsyncStorage.getItem.mockResolvedValue('invalid-timestamp');

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });

    it('handles AsyncStorage read failure gracefully', async () => {
      mockAsyncStorage.getItem.mockRejectedValue(new Error('Read error'));

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });
  });

  describe('Process reboot and clock rollback scenarios', () => {
    it('survives app process death: elapsed time is calculated from persisted timestamp on relaunch', async () => {
      const backgroundTime = Date.now();
      mockAsyncStorage.getItem.mockResolvedValue(String(backgroundTime));

      // Simulate time passing during process death and relaunch
      jest.advanceTimersByTime(8000);

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBeGreaterThanOrEqual(8000);
    });

    it('detects clock rollback: if background timestamp is in future, treats as no elapsed time', async () => {
      const futureTime = Date.now() + 60000;
      mockAsyncStorage.getItem.mockResolvedValue(String(futureTime));

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBe(0);
    });

    it('handles large clock-forward jump safely', async () => {
      const backgroundTime = Date.now();
      mockAsyncStorage.getItem.mockResolvedValue(String(backgroundTime));

      jest.advanceTimersByTime(3600000); // 1 hour

      const elapsed = await getElapsedSinceBackground();
      expect(elapsed).toBeGreaterThanOrEqual(3600000);
    });
  });

  describe('clearPersistedTimestamps', () => {
    it('clears both background and foreground timestamps', async () => {
      mockAsyncStorage.removeItem.mockResolvedValue(null);

      await clearPersistedTimestamps();

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledTimes(2);
    });
  });

  describe('Privacy-preserving app lock setting (Issue #1188)', () => {
    it('defaults to privacy-preserving settings that cover sensitive pet screens', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);

      const config = await loadPrivacyAppLockConfig();
      expect(config).toEqual(DEFAULT_PRIVACY_APP_LOCK_CONFIG);
      expect(config.enabled).toBe(true);
      expect(config.coverInAppSwitcher).toBe(true);
      expect(config.redactPetPreviewDetails).toBe(true);
    });

    it('covers sensitive screens in app switcher previews and respects reduceMotion accessibility', async () => {
      const standardCover = await applyAppSwitcherPrivacyCover(
        'MedicalRecordsScreen',
        DEFAULT_PRIVACY_APP_LOCK_CONFIG,
        { reduceMotionEnabled: false },
      );

      expect(standardCover.covered).toBe(true);
      expect(standardCover.blurIntensity).toBe(0.85);
      expect(mockScreenCapture.preventScreenCaptureAsync).toHaveBeenCalled();
      expect(mockScreenCapture.enableAppSwitcherProtectionAsync).toHaveBeenCalledWith(0.85);

      const reducedMotionCover = await applyAppSwitcherPrivacyCover(
        'MedicalRecordsScreen',
        DEFAULT_PRIVACY_APP_LOCK_CONFIG,
        { reduceMotionEnabled: true },
      );

      expect(reducedMotionCover.covered).toBe(true);
      expect(reducedMotionCover.blurIntensity).toBe(1.0);
      expect(mockScreenCapture.enableAppSwitcherProtectionAsync).toHaveBeenCalledWith(1.0);

      const publicScreen = await applyAppSwitcherPrivacyCover(
        'OnboardingScreen',
        DEFAULT_PRIVACY_APP_LOCK_CONFIG,
      );
      expect(publicScreen.covered).toBe(false);
    });

    it('evaluates optional relock timing and locks conservatively on clock rollback', async () => {
      const now = 1_700_000_000_000;

      const immediate = await evaluateRelockRequirement(
        { ...DEFAULT_PRIVACY_APP_LOCK_CONFIG, relockTiming: 'immediate' },
        now,
      );
      expect(immediate).toEqual({
        shouldLock: true,
        reason: 'immediate',
        elapsedMs: 0,
      });

      mockAsyncStorage.getItem.mockResolvedValue(String(now - 30_000));
      const withinGrace = await evaluateRelockRequirement(
        { ...DEFAULT_PRIVACY_APP_LOCK_CONFIG, relockTiming: '1min' },
        now,
      );
      expect(withinGrace.shouldLock).toBe(false);
      expect(withinGrace.reason).toBe('within_grace_period');

      mockAsyncStorage.getItem.mockResolvedValue(String(now - 120_000));
      const elapsed = await evaluateRelockRequirement(
        { ...DEFAULT_PRIVACY_APP_LOCK_CONFIG, relockTiming: '1min' },
        now,
      );
      expect(elapsed.shouldLock).toBe(true);
      expect(elapsed.reason).toBe('timeout_elapsed');

      // Clock rollback tampering must trigger relock
      mockAsyncStorage.getItem.mockResolvedValue(String(now + 60_000));
      const rollback = await evaluateRelockRequirement(
        { ...DEFAULT_PRIVACY_APP_LOCK_CONFIG, relockTiming: '5min' },
        now,
      );
      expect(rollback.shouldLock).toBe(true);
      expect(rollback.reason).toBe('clock_rollback');
    });

    it('confirms policy updates with the server and preserves offline behavior with retries', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);
      mockAsyncStorage.setItem.mockResolvedValue(null);

      // Offline save preserves setting locally
      const offlineResult = await updatePrivacyAppLockSetting(
        { relockTiming: '5min' },
        { isOnline: false, nowMs: 1000 },
      );
      expect(offlineResult.status).toBe('pending_offline');
      expect(offlineResult.config.relockTiming).toBe('5min');

      // Flaky server succeeds on retry
      let calls = 0;
      const confirmOnServer = jest.fn().mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('Transient network failure');
        }
        return { ok: true, status: 200, confirmed: true, serverPolicyVersion: 2 };
      });

      const confirmed = await updatePrivacyAppLockSetting(
        { relockTiming: '15min' },
        { isOnline: true, maxRetries: 2, confirmOnServer, nowMs: 2000 },
      );
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.serverConfirmed).toBe(true);
      expect(confirmed.config.policyVersion).toBe(2);
      expect(confirmOnServer).toHaveBeenCalledTimes(2);
    });

    it('handles server permission denial and stale policy states with explicit recovery', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(
        JSON.stringify(DEFAULT_PRIVACY_APP_LOCK_CONFIG),
      );
      mockAsyncStorage.setItem.mockResolvedValue(null);

      const denied = await updatePrivacyAppLockSetting(
        { enabled: false, coverInAppSwitcher: false },
        {
          isOnline: true,
          confirmOnServer: jest.fn().mockResolvedValue({
            ok: false,
            status: 403,
            permissionDenied: true,
          }),
        },
      );

      expect(denied.status).toBe('denied');
      expect(denied.config.coverInAppSwitcher).toBe(true);
      expect(denied.recovery?.action).toBe('reauthenticate_session');
      expect(denied.recovery?.keepSensitiveContentCovered).toBe(true);

      const stale = await updatePrivacyAppLockSetting(
        { relockTiming: '5min' },
        {
          isOnline: true,
          confirmOnServer: jest.fn().mockResolvedValue({
            ok: false,
            status: 409,
            stalePolicy: true,
            serverPolicyVersion: 4,
            enforcedConfig: { relockTiming: '1min' },
          }),
        },
      );

      expect(stale.status).toBe('stale');
      expect(stale.config.policyVersion).toBe(4);
      expect(stale.config.relockTiming).toBe('1min');
      expect(stale.recovery?.action).toBe('refresh_policy');
    });

    it('provides explicit unlock recovery actions while keeping sensitive content covered', () => {
      const retryBio = resolveAppLockRecovery({
        failedAttempts: 1,
        biometricAvailable: true,
        passcodeConfigured: true,
      });
      expect(retryBio.action).toBe('retry_biometric');
      expect(retryBio.keepSensitiveContentCovered).toBe(true);

      const passcodeFallback = resolveAppLockRecovery({
        failedAttempts: 3,
        maxAttempts: 3,
        biometricAvailable: true,
        passcodeConfigured: true,
      });
      expect(passcodeFallback.action).toBe('use_passcode_fallback');
      expect(passcodeFallback.reason).toBe('max_attempts_exceeded');

      const reauthFallback = resolveAppLockRecovery({
        failedAttempts: 3,
        maxAttempts: 3,
        biometricAvailable: false,
        passcodeConfigured: false,
      });
      expect(reauthFallback.action).toBe('reauthenticate_session');
    });
  });
});

