/**
 * Tests for biometric authentication fallback — Issue #404
 */

// A minimal valid-looking JWT with exp far in the future (year 2099)
// Header: {"alg":"HS256","typ":"JWT"}
// Payload: {"sub":"user1","exp":4102444800,"iat":1000000000}
const MOCK_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyMSIsImV4cCI6NDEwMjQ0NDgwMCwiaWF0IjoxMDAwMDAwMDAwfQ.' +
  'signature';

jest.mock('../../utils/encryption/keychain', () => ({
  authenticateWithBiometricGate: jest.fn(),
  clearSecureTokens: jest.fn().mockResolvedValue(undefined),
  disableBiometricAuthentication: jest.fn().mockResolvedValue(undefined),
  enableBiometricAuthentication: jest.fn().mockResolvedValue(undefined),
  getBiometricAvailability: jest.fn(),
  getSecureRefreshToken: jest.fn().mockResolvedValue(null),
  getSecureToken: jest.fn(() => MOCK_JWT),
  getSecureTokens: jest.fn(() => ({ token: MOCK_JWT, refreshToken: 'mock-refresh' })),
  isBiometricAuthenticationEnabled: jest.fn(),
  storeSecureTokens: jest.fn().mockResolvedValue(undefined),
}));

import {
  clearBiometricFallbackPreference,
  isBiometricAuthenticationAvailable,
  isBiometricAuthenticationEnabled,
  loginWithBiometricOrFallback,
  setPin,
  shouldPromptBiometricSetup,
  verifyPin,
} from '../../services/authService';
import {
  getBiometricAvailability,
  isBiometricAuthenticationEnabled as isBiometricStorageEnabled,
  authenticateWithBiometricGate,
} from '../../utils/encryption/keychain';

const SecureStore = require('expo-secure-store');

const mockGetBiometricAvailability = getBiometricAvailability as jest.Mock;
const mockIsBiometricEnabled = isBiometricStorageEnabled as jest.Mock;
const mockAuthGate = authenticateWithBiometricGate as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.getItemAsync.mockResolvedValue(null);
  SecureStore.setItemAsync.mockResolvedValue(undefined);
  SecureStore.deleteItemAsync.mockResolvedValue(undefined);
  mockGetBiometricAvailability.mockResolvedValue({ isAvailable: true, biometryType: 'FaceID' });
  mockIsBiometricEnabled.mockResolvedValue(true);
  mockAuthGate.mockResolvedValue(true);
});

describe('authService — Biometric Fallback (Issue #404)', () => {
  describe('isBiometricAuthenticationAvailable', () => {
    it('returns true when hardware is available', async () => {
      expect(await isBiometricAuthenticationAvailable()).toBe(true);
    });

    it('returns false when hardware is unavailable', async () => {
      mockGetBiometricAvailability.mockResolvedValue({ isAvailable: false, biometryType: null });
      expect(await isBiometricAuthenticationAvailable()).toBe(false);
    });
  });

  describe('loginWithBiometricOrFallback', () => {
    it('succeeds with biometrics when available and enrolled', async () => {
      const result = await loginWithBiometricOrFallback();
      expect(result.success).toBe(true);
      expect(result.fallbackRequired).toBe(false);
      expect(result.session).toBeDefined();
    });

    it('returns fallback=unavailable when biometrics not available', async () => {
      mockGetBiometricAvailability.mockResolvedValue({ isAvailable: false, biometryType: null });
      const result = await loginWithBiometricOrFallback();
      expect(result.success).toBe(false);
      expect(result.fallbackRequired).toBe(true);
      expect(result.fallbackReason).toBe('unavailable');
    });

    it('returns fallback=user_preference when biometrics disabled', async () => {
      mockIsBiometricEnabled.mockResolvedValue(false);
      const result = await loginWithBiometricOrFallback();
      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('user_preference');
    });

    it('returns fallback=user_preference when pin pref is stored', async () => {
      SecureStore.getItemAsync.mockResolvedValue('pin');
      const result = await loginWithBiometricOrFallback();
      expect(result.success).toBe(false);
      expect(result.fallbackReason).toBe('user_preference');
    });

    it('falls back after 3 failed biometric attempts', async () => {
      mockAuthGate.mockResolvedValue(false);
      const result = await loginWithBiometricOrFallback();
      expect(result.success).toBe(false);
      expect(result.fallbackRequired).toBe(true);
      expect(result.fallbackReason).toBe('max_attempts_reached');
      // Should persist pin preference
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'com.petchain.auth.biometric.fallback.pref',
        'pin',
      );
    });
  });

  describe('PIN management', () => {
    it('sets and verifies a correct PIN', async () => {
      SecureStore.getItemAsync.mockResolvedValue(null);
      await setPin('1234');
      expect(SecureStore.setItemAsync).toHaveBeenCalled();

      // Simulate stored hash
      const storedHash = SecureStore.setItemAsync.mock.calls[0][1];
      SecureStore.getItemAsync.mockResolvedValue(storedHash);
      const valid = await verifyPin('1234');
      expect(valid).toBe(true);
    });

    it('rejects an incorrect PIN', async () => {
      SecureStore.getItemAsync.mockResolvedValue('wronghash');
      const valid = await verifyPin('9999');
      expect(valid).toBe(false);
    });
  });

  describe('clearBiometricFallbackPreference', () => {
    it('deletes the fallback preference key', async () => {
      await clearBiometricFallbackPreference();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
        'com.petchain.auth.biometric.fallback.pref',
      );
    });
  });

  describe('shouldPromptBiometricSetup', () => {
    it('returns true when pin pref is stored and biometrics available', async () => {
      SecureStore.getItemAsync.mockResolvedValue('pin');
      expect(await shouldPromptBiometricSetup()).toBe(true);
    });

    it('returns false when no pref stored', async () => {
      SecureStore.getItemAsync.mockResolvedValue(null);
      expect(await shouldPromptBiometricSetup()).toBe(false);
    });

    it('returns false when biometrics unavailable', async () => {
      mockGetBiometricAvailability.mockResolvedValue({ isAvailable: false, biometryType: null });
      SecureStore.getItemAsync.mockResolvedValue('pin');
      expect(await shouldPromptBiometricSetup()).toBe(false);
    });
  });
});
