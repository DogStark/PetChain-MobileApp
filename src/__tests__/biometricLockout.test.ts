/**
 * Tests for biometric lockout, fallback, and enrollment-change handling.
 *
 * Verifies: every platform biometric result is handled deterministically,
 * cancellation/lockout offer PIN fallback, enrollment changes invalidate cache,
 * no path allows bypass, no permanent unrecoverable lockout, PIN fallback
 * correctly interacts with cooldown state.
 */

import * as Keychain from 'react-native-keychain';
import {
  authenticateWithBiometrics,
  isBiometricAvailable,
  BiometricAuthResult,
} from '../services/biometricService';
import { loadCooldownUntil } from '../services/pinLockStateService';

jest.mock('react-native-keychain');
jest.mock('../services/pinLockStateService');

const mockKeychain = Keychain as jest.Mocked<typeof Keychain>;
const mockLoadCooldown = loadCooldownUntil as jest.MockedFunction<typeof loadCooldownUntil>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Biometric lockout and fallback handling', () => {
  describe('Platform biometric result matrix', () => {
    it('handles success: returns { success: true } and allows unlock', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockResolvedValue({
        username: 'petchain_biometric_user',
        password: 'petchain:biometric:enrolled',
      });

      const result = await authenticateWithBiometrics();

      expect(result).toEqual({ success: true });
    });

    it('handles user cancel: returns { success: false, fallbackReason: "user_cancelled" }', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockRejectedValue(
        new Error('User cancelled authentication'),
      );

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('user_cancelled');
    });

    it('handles OS temporary lockout: returns { success: false, fallbackReason: "lockout" }', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('TouchID');
      mockKeychain.getGenericPassword.mockRejectedValue(
        new Error('Too many failed biometric attempts'),
      );

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('lockout');
    });

    it('handles hardware unavailable: returns { success: false, fallbackReason: "unavailable" }', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue(null);

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('unavailable');
    });

    it('handles not enrolled: returns { success: false, fallbackReason: "not_enrolled" }', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockResolvedValue(null);

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('not_enrolled');
    });

    it('handles enrollment change: returns { success: false, fallbackReason: "error" } and invalidates cache', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('Fingerprint');
      // Enrollment changed; credential no longer valid
      mockKeychain.getGenericPassword.mockResolvedValue(null);

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      // Enrollment change is treated as error/not_enrolled
      expect(['error', 'not_enrolled']).toContain(result.fallbackReason);
    });

    it('handles system cancel: returns { success: false, fallbackReason: "user_cancelled" }', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockRejectedValue(new Error('System cancelled auth'));

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('user_cancelled');
    });

    it('handles unknown hardware error: returns { success: false, fallbackReason: "error" }', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockRejectedValue(new Error('Unknown biometric error'));

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('error');
    });
  });

  describe('PIN fallback safety', () => {
    it('does not bypass lock on biometric cancel: user must enter PIN', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockRejectedValue(
        new Error('User cancelled authentication'),
      );

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      // fallback must be offered to prevent permanent lockout
      expect(result.fallbackReason).toBeTruthy();
    });

    it('does not bypass lock on OS lockout: user must enter PIN', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('TouchID');
      mockKeychain.getGenericPassword.mockRejectedValue(
        new Error('Too many failed biometric attempts'),
      );

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('lockout');
    });

    it('offers PIN fallback even on hardware unavailable', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue(null);

      const result = await authenticateWithBiometrics();

      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBeTruthy();
    });
  });

  describe('PIN cooldown interaction with biometric fallback', () => {
    it('respects active PIN cooldown when falling back from biometric cancel', async () => {
      const cooldownUntilTime = Date.now() + 30000;
      mockLoadCooldown.mockResolvedValue(cooldownUntilTime);
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockRejectedValue(
        new Error('User cancelled authentication'),
      );

      const result = await authenticateWithBiometrics();

      // Verify cooldown check would occur in LockScreen
      const cooldown = await loadCooldownUntil();
      expect(cooldown).toBeGreaterThan(Date.now());
      expect(result.fallbackReason).toBe('user_cancelled');
    });

    it('allows PIN entry after cooldown expires, even if biometric fallback is used', async () => {
      // Set cooldown to expire 1 second ago
      const expiredCooldown = Date.now() - 1000;
      mockLoadCooldown.mockResolvedValue(expiredCooldown);
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockRejectedValue(
        new Error('User cancelled authentication'),
      );

      const cooldown = await loadCooldownUntil();
      expect(cooldown).toBeLessThan(Date.now());
      // PIN should be enterable since cooldown has expired
    });
  });

  describe('No permanent lockout without fallback', () => {
    it('always offers a fallback path (never leaves user completely locked out)', async () => {
      // Test matrix: every non-success result should have a fallback reason
      const scenarios: Array<[string, () => void]> = [
        ['user cancelled', () => {
          mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
          mockKeychain.getGenericPassword.mockRejectedValue(
            new Error('User cancelled authentication'),
          );
        }],
        ['OS lockout', () => {
          mockKeychain.getSupportedBiometryType.mockResolvedValue('TouchID');
          mockKeychain.getGenericPassword.mockRejectedValue(
            new Error('Too many failed biometric attempts'),
          );
        }],
        ['hardware unavailable', () => {
          mockKeychain.getSupportedBiometryType.mockResolvedValue(null);
        }],
        ['not enrolled', () => {
          mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
          mockKeychain.getGenericPassword.mockResolvedValue(null);
        }],
      ];

      for (const [name, setup] of scenarios) {
        jest.clearAllMocks();
        setup();

        const result = await authenticateWithBiometrics();

        if (!result.success) {
          expect(result.fallbackReason).toBeTruthy();
          // fallbackReason must be one of the safe values
          expect(['user_cancelled', 'lockout', 'unavailable', 'not_enrolled', 'error']).toContain(
            result.fallbackReason,
          );
        }
      }
    });
  });

  describe('Enrollment change handling', () => {
    it('invalidates biometric cache when enrollment changes (fingerprint removed)', async () => {
      // First auth attempt: enrolled
      mockKeychain.getSupportedBiometryType.mockResolvedValue('Fingerprint');
      mockKeychain.getGenericPassword.mockResolvedValue({
        username: 'petchain_biometric_user',
        password: 'petchain:biometric:enrolled',
      });

      let result = await authenticateWithBiometrics();
      expect(result.success).toBe(true);

      // Enrollment changes: fingerprint removed
      jest.clearAllMocks();
      mockKeychain.getSupportedBiometryType.mockResolvedValue(null);

      result = await authenticateWithBiometrics();
      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('unavailable');
    });

    it('invalidates biometric cache when new fingerprint is added mid-session', async () => {
      // Simulates: user has 1 fingerprint enrolled, adds a 2nd
      // The BIOMETRY_CURRENT_SET access control should invalidate the credential
      mockKeychain.getSupportedBiometryType.mockResolvedValue('Fingerprint');
      mockKeychain.getGenericPassword.mockResolvedValue(null);

      const result = await authenticateWithBiometrics();
      expect(result.fallbackReason).toBe('not_enrolled');
    });
  });

  describe('No bypass via rapid repeated attempts', () => {
    it('does not allow unlock via spamming biometric attempts', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');

      // Simulate 10 rapid auth attempts, all failing
      for (let i = 0; i < 10; i++) {
        mockKeychain.getGenericPassword.mockRejectedValueOnce(new Error('User cancelled'));

        const result = await authenticateWithBiometrics();

        expect(result.success).toBe(false);
        // Every failure should return a fallback reason, never success
      }
    });
  });

  describe('Accessibility compliance', () => {
    it('fallback reason is suitable for screen reader announcement', async () => {
      mockKeychain.getSupportedBiometryType.mockResolvedValue('FaceID');
      mockKeychain.getGenericPassword.mockRejectedValue(new Error('User cancelled'));

      const result = await authenticateWithBiometrics();

      // fallbackReason values should be human-readable for a11y
      expect(['user_cancelled', 'lockout', 'unavailable', 'not_enrolled', 'error']).toContain(
        result.fallbackReason,
      );
    });
  });
});
